/**
 * 우성고 카드 시스템 - Code.gs
 * - 영수증 이미지: 구글 슬라이드 템플릿의 {{영수증_이미지}} 영역에 꽉 채우기(stretch) 방식으로 삽입
 */

const CONFIG = {
  SPREADSHEET_ID: "1cYLltwuSFURGo2Yi3cHPZ4oob7q4-o42c74caVeaUTA",
  GEMINI_API_KEY: PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY"),
  SLIDE_TEMPLATE_ID: "1iBJ_3bTWPJQQzF4MHH9DReE5RKI76Dd2ITk938zhAYU",
  FINAL_RECEIPT_FOLDER_ID: "1g77SKjvYSfE6fMS5-_trXwm-oPSdliUi",
  TEMP_FOLDER_ID: "1EnR2qTqC2Lx7ew1D4wNRXozwJBafZQZe",
  ADMIN_PIN: "9100",
  RETURN_MAX_RETRY: 5,

  MASTER_CART_FILE_NAME: "all_saved_carts.json",
  CARD_STATUS: {
    AVAILABLE: "사용가능",
    IN_USE: "사용중",
    RETURN_PROCESSING: "반납처리중"
  },
  PURPOSE: {
    UI_MEAL: "특근매식",
    SHEET_MEAL: "특근매식비"
  },
  QUEUE_STATUS: {
    PENDING: "PENDING",
    PROCESSING: "PROCESSING",
    RETRY_PENDING: "RETRY_PENDING",
    COMPLETED: "COMPLETED",
    ERROR_FINAL: "ERROR_FINAL"
  },
  SHEET_NAMES: {
    MAIN: "시트1",
    STATUS: "카드상태",
    USER: "내선번호",
    QUEUE: "반납처리대기"
  }
};

function onEdit(e) {
  SheetService.handleOnEdit(e);
}

function doGet() {
  return HtmlService.createHtmlOutputFromFile("index")
    .setTitle("우성고 카드 관리")
    .addMetaTag("viewport", "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getInitialAppData() {
  return CardService.getInitialData();
}

function getSavedCarts(ids) {
  return CardService.loadCarts(ids);
}

function saveCartToMasterFile(data) {
  return CardService.saveCart(data);
}

function processReceiptImage(base64) {
  return GeminiService.analyzeReceipt(base64);
}

function deleteMainRowByCheckbox(rowNumber) {
  return LockManager.withRetry(() => {
    const mainSheet = SheetService.getSheet(CONFIG.SHEET_NAMES.MAIN);
    if (!mainSheet) throw new Error("MAIN_SHEET_NOT_FOUND");
    if (!rowNumber || rowNumber <= 1) throw new Error("INVALID_ROW");

    SheetService._deleteRowAndResetStatus(mainSheet, rowNumber);
    return { status: "success" };
  });
}

function setupQueueTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "processQueue")
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger("processQueue")
    .timeBased()
    .everyMinutes(1)
    .create();

  return { status: "success", message: "QUEUE_TRIGGER_INSTALLED" };
}

function rentNow(params) {
  return LockManager.withRetry(() => {
    const statusSheet = SheetService.getSheet(CONFIG.SHEET_NAMES.STATUS);
    const rowIndex = SheetService.findRowIndexByCardId(statusSheet, params.cardNumber);

    if (rowIndex <= 0) throw new Error("CARD_NOT_FOUND");

    const normalizedPurpose = PurposeService.normalize(params.purpose);

    if (PurposeService.isMeal(normalizedPurpose)) {
      const exts = Array.isArray(params.userExtensions) ? params.userExtensions : [];
      if (!exts.length) throw new Error("UNAUTHORIZED_MEAL");

      const userSheet = SheetService.getSheet(CONFIG.SHEET_NAMES.USER);
      const values = userSheet.getDataRange().getValues();
      const roleByExt = {};

      for (let i = 1; i < values.length; i++) {
        const ext = String(values[i][0] || "").trim();
        if (!ext) continue;
        roleByExt[ext] = String(values[i][2] || "").trim();
      }

      const ok = exts.every(ext => roleByExt[String(ext).trim()] === "사무직원");
      if (!ok) throw new Error("UNAUTHORIZED_MEAL");
    }

    const currentStatus = String(statusSheet.getRange(rowIndex, 2).getValue()).trim();
    if (currentStatus === CONFIG.CARD_STATUS.IN_USE || currentStatus === CONFIG.CARD_STATUS.RETURN_PROCESSING) {
      return { status: "conflict", message: "ALREADY_IN_USE" };
    }

    const today = new Date();
    const displayPurpose = PurposeService.toDisplay(normalizedPurpose);
    const sheetPurpose = PurposeService.toSheet(normalizedPurpose);

    statusSheet
      .getRange(rowIndex, 2, 1, 4)
      .setValues([[CONFIG.CARD_STATUS.IN_USE, params.userName, today, displayPurpose]]);

    const mainSheet = SheetService.getSheet(CONFIG.SHEET_NAMES.MAIN);
    const nextRow = SheetService.getNextDataRow(mainSheet, 1);

    SheetService.safeWriteRow(mainSheet, nextRow, [
      today,
      "",
      params.userName,
      params.cardNumber,
      PurposeService.isMeal(normalizedPurpose) ? sheetPurpose : "",
      "",
      "",
      CONFIG.CARD_STATUS.IN_USE,
      "",
      sheetPurpose,
      ""
    ]);

    return { status: "success" };
  });
}

function queueReturnRequest(params) {
  return LockManager.withRetry(() => {
    const adminPin = String(params?.adminPin || "").trim();
    if (adminPin !== String(CONFIG.ADMIN_PIN)) {
      throw new Error("ADMIN_ONLY");
    }

    const statusSheet = SheetService.getSheet(CONFIG.SHEET_NAMES.STATUS);
    const sIdx = SheetService.findRowIndexByCardId(statusSheet, params.cardNumber);
    if (sIdx <= 0) throw new Error("CARD_NOT_FOUND");

    const currentRow = statusSheet.getRange(sIdx, 2, 1, 4).getValues()[0];
    const currentStatus = String(currentRow[0] || "").trim();
    const currentUser = currentRow[1] || "";
    const currentReceiveDate = currentRow[2] || "";
    const currentPurpose = currentRow[3] || "";

    if (currentStatus === CONFIG.CARD_STATUS.RETURN_PROCESSING) {
      return { status: "success", message: "ALREADY_PROCESSING" };
    }

    statusSheet
      .getRange(sIdx, 2, 1, 4)
      .setValues([[CONFIG.CARD_STATUS.RETURN_PROCESSING, currentUser, currentReceiveDate, currentPurpose]]);

    QueueService.addToQueue("RETURN_PROCESS", {
      cardNumber: params.cardNumber,
      receiveDate: params.receiveDate,
      multiEntries: params.multiEntries,
      userName: params.userName,
      purpose: PurposeService.toSheet(params.purpose || currentPurpose)
    });

    return { status: "success" };
  });
}

function processQueue() {
  QueueService.processAll();
}

const PurposeService = {
  normalize: function (purpose) {
    const value = String(purpose || "").trim();
    if (!value) return "";
    if (value === CONFIG.PURPOSE.UI_MEAL || value === CONFIG.PURPOSE.SHEET_MEAL || value === "특근매식비사용") {
      return CONFIG.PURPOSE.UI_MEAL;
    }
    return value;
  },

  isMeal: function (purpose) {
    return this.normalize(purpose) === CONFIG.PURPOSE.UI_MEAL;
  },

  toDisplay: function (purpose) {
    return this.isMeal(purpose) ? CONFIG.PURPOSE.UI_MEAL : String(purpose || "").trim();
  },

  toSheet: function (purpose) {
    return this.isMeal(purpose) ? CONFIG.PURPOSE.SHEET_MEAL : String(purpose || "").trim();
  }
};

const LockManager = {
  withRetry: function (func) {
    const lock = LockService.getScriptLock();
    const props = PropertiesService.getScriptProperties();
    const key = "EXEC_IN_PROGRESS_V1";
    const now = Date.now();
    const staleMs = 2 * 60 * 1000;

    const raw = props.getProperty(key);
    if (raw) {
      let parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        props.deleteProperty(key);
      }

      if (parsed) {
        const ts = Number(parsed.ts || 0);
        if (now - ts < staleMs) throw new Error("SERVER_BUSY");
        props.deleteProperty(key);
      }
    }

    let locked = false;

    try {
      locked = lock.tryLock(12000);
      if (!locked) throw new Error("SERVER_BUSY");

      props.setProperty(key, JSON.stringify({
        ts: Date.now(),
        fn: func.name || "anonymous"
      }));

      return func();
    } finally {
      try {
        props.deleteProperty(key);
      } catch (_) {}

      if (locked) lock.releaseLock();
    }
  }
};

const QueueService = {
  addToQueue: function (type, params) {
    const sheet = SheetService.getSheet(CONFIG.SHEET_NAMES.QUEUE);
    if (!sheet) throw new Error("QUEUE_SHEET_NOT_FOUND");

    sheet.appendRow([
      new Date(),
      type,
      JSON.stringify(params),
      CONFIG.QUEUE_STATUS.PENDING,
      0,
      ""
    ]);
  },

  processAll: function () {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) return;

    try {
      const qSheet = SheetService.getSheet(CONFIG.SHEET_NAMES.QUEUE);
      const data = qSheet.getDataRange().getValues();
      if (data.length < 2) return;

      const mainSheet = SheetService.getSheet(CONFIG.SHEET_NAMES.MAIN);
      const statusSheet = SheetService.getSheet(CONFIG.SHEET_NAMES.STATUS);
      const rowsToDelete = [];
      const startTime = Date.now();

      for (let i = 1; i < data.length; i++) {
        if (Date.now() - startTime > 5 * 60 * 1000) break;

        const rowNum = i + 1;
        const [, type, jsonParams, status, retryCountRaw] = data[i];
        const retryCount = Number(retryCountRaw || 0);

        if (status === CONFIG.QUEUE_STATUS.COMPLETED || status === CONFIG.QUEUE_STATUS.ERROR_FINAL) continue;

        try {
          qSheet.getRange(rowNum, 4, 1, 3).setValues([[CONFIG.QUEUE_STATUS.PROCESSING, retryCount, ""]]);

          const params = JSON.parse(jsonParams || "{}");
          if (type === "RETURN_PROCESS") {
            this._handleReturnProcess(mainSheet, statusSheet, params);
          } else {
            throw new Error("UNKNOWN_QUEUE_TYPE");
          }

          qSheet.getRange(rowNum, 4, 1, 3).setValues([[CONFIG.QUEUE_STATUS.COMPLETED, retryCount, ""]]);
          rowsToDelete.push(rowNum);
        } catch (e) {
          const nextRetry = retryCount + 1;
          const nextStatus = nextRetry >= CONFIG.RETURN_MAX_RETRY
            ? CONFIG.QUEUE_STATUS.ERROR_FINAL
            : CONFIG.QUEUE_STATUS.RETRY_PENDING;

          qSheet.getRange(rowNum, 4, 1, 3).setValues([[
            nextStatus,
            nextRetry,
            String(e.message || e)
          ]]);
        }
      }

      rowsToDelete
        .sort((a, b) => b - a)
        .forEach(r => qSheet.deleteRow(r));
    } finally {
      lock.releaseLock();
    }
  },

  _handleReturnProcess: function (mainSheet, statusSheet, params) {
    const { cardNumber, receiveDate, multiEntries, userName } = params;
    const entries = JSON.parse(multiEntries || "[]");
    const allData = mainSheet.getDataRange().getValues();
    const rowsToDelete = [];
    let savedPurpose = "일반카드사용";
    const paramDate = CardService.formatDate(receiveDate);

    for (let j = allData.length - 1; j >= 1; j--) {
      const rowDate = CardService.formatDate(allData[j][0]);
      const isSameCard = String(allData[j][3]).trim() === String(cardNumber).trim();
      const isSameDate = rowDate && paramDate && rowDate === paramDate;
      const isInUseLog = String(allData[j][7]).trim() === CONFIG.CARD_STATUS.IN_USE;

      if (isSameCard && isSameDate && isInUseLog) {
        rowsToDelete.push(j + 1);
        if (allData[j][9]) savedPurpose = String(allData[j][9]);
      }
    }

    rowsToDelete
      .sort((a, b) => b - a)
      .forEach(r => mainSheet.deleteRow(r));

    const purposeToUse = PurposeService.toSheet(params.purpose || savedPurpose);

    if (entries.length > 0) {
      entries.forEach(e => {
        let fileUrl = "";
        const dateToUse = (e.date && String(e.date).length >= 10)
          ? String(e.date)
          : (paramDate || CardService.formatDate(new Date()));

        if (e.receiptImage) {
          try {
            fileUrl = SlideService.createReceiptImage({
              date: dateToUse,
              user: userName,
              store: e.usagePlace,
              amount: e.amount,
              details: e.usageDetails,
              image: e.receiptImage,
              cardNumber: cardNumber
            }) || "";
          } catch (err) {
            fileUrl = "";
          }
        }

        const hyperlink = fileUrl ? `=HYPERLINK("${fileUrl}", "영수증")` : "";
        const nextRow = SheetService.getNextDataRow(mainSheet, 1);

        SheetService.safeWriteRow(mainSheet, nextRow, [
          new Date(receiveDate),
          new Date(),
          userName,
          cardNumber,
          e.usageDetails || "",
          e.usagePlace || "",
          Number(e.amount || 0),
          CONFIG.CARD_STATUS.AVAILABLE,
          hyperlink,
          purposeToUse,
          ""
        ]);
      });
    } else {
      const nextRow = SheetService.getNextDataRow(mainSheet, 1);

      SheetService.safeWriteRow(mainSheet, nextRow, [
        new Date(receiveDate),
        new Date(),
        userName,
        cardNumber,
        "사용 내역 없음 (단순 반납)",
        "",
        0,
        CONFIG.CARD_STATUS.AVAILABLE,
        "",
        purposeToUse,
        ""
      ]);
    }

    const statusRow = SheetService.findRowIndexByCardId(statusSheet, cardNumber);
    if (statusRow > 0) {
      statusSheet
        .getRange(statusRow, 2, 1, 4)
        .setValues([[CONFIG.CARD_STATUS.AVAILABLE, "", "", ""]]);
    }

    CardService.deleteCart(cardNumber);
  }
};

const CardService = {
  getInitialData: function () {
    const statusSheet = SheetService.getSheet(CONFIG.SHEET_NAMES.STATUS);
    const userSheet = SheetService.getSheet(CONFIG.SHEET_NAMES.USER);

    if (!statusSheet || !userSheet) {
      return { allCards: [], allUsers: [] };
    }

    const lastStatusRow = statusSheet.getLastRow();
    const lastUserRow = userSheet.getLastRow();

    const statusData = lastStatusRow >= 2
      ? statusSheet.getRange(2, 1, lastStatusRow - 1, 5).getValues()
      : [];

    const userData = lastUserRow >= 2
      ? userSheet.getRange(2, 1, lastUserRow - 1, 3).getValues()
      : [];

    return {
      allCards: statusData.map(r => ({
        id: String(r[0] || "").trim(),
        displayName: String(r[0] || "").includes("해외")
          ? "해외결제카드"
          : String(r[0] || "").split("-")[0],
        status: String(r[1] || "").trim(),
        userInfo: (function () {
          const status = String(r[1] || "").trim();
          if (status !== CONFIG.CARD_STATUS.IN_USE && status !== CONFIG.CARD_STATUS.RETURN_PROCESSING) {
            return null;
          }
          return {
            userName: String(r[2] || ""),
            receiveDate: CardService.formatDate(r[3]),
            purpose: PurposeService.toDisplay(r[4])
          };
        })(),
        savedCart: []
      })).filter(c => c.id),

      allUsers: userData.map(r => ({
        extension: String(r[0] || "").trim(),
        name: String(r[1] || "").trim(),
        role: String(r[2] || "").trim()
      })).filter(u => u.extension)
    };
  },

  loadCarts: function (ids) {
    try {
      const files = DriveApp
        .getFolderById(CONFIG.TEMP_FOLDER_ID)
        .getFilesByName(CONFIG.MASTER_CART_FILE_NAME);

      if (files.hasNext()) {
        const data = JSON.parse(files.next().getBlob().getDataAsString() || "{}");
        const result = {};

        (ids || []).forEach(id => {
          if (data[id]) result[id] = data[id];
        });

        return result;
      }
    } catch (e) {}

    return {};
  },

  saveCart: function (data) {
    if (!data || !data.cardId) throw new Error("INVALID_CART_DATA");
    return this._updateMasterFile(data.cardId, data.cartData);
  },

  deleteCart: function (id) {
    return this._updateMasterFile(id, undefined);
  },

  _updateMasterFile: function (key, value) {
    const lock = LockService.getScriptLock();
    let locked = false;

    try {
      locked = lock.tryLock(12000);
      if (!locked) return { status: "error" };

      const folder = DriveApp.getFolderById(CONFIG.TEMP_FOLDER_ID);
      const files = folder.getFilesByName(CONFIG.MASTER_CART_FILE_NAME);

      let file;
      let data = {};

      if (files.hasNext()) {
        file = files.next();
        try {
          data = JSON.parse(file.getBlob().getDataAsString() || "{}");
        } catch (e) {
          data = {};
        }
      } else {
        file = folder.createFile(CONFIG.MASTER_CART_FILE_NAME, "{}", "application/json");
      }

      if (value === undefined) {
        delete data[key];
      } else {
        data[key] = value;
      }

      file.setContent(JSON.stringify(data));
      return { status: "success" };
    } finally {
      if (locked) lock.releaseLock();
    }
  },

  formatDate: function (d) {
    if (!d) return null;

    const date = new Date(d);
    if (isNaN(date)) return null;

    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }
};

const SlideService = {
  createReceiptImage: function (data) {
    if (!CONFIG.SLIDE_TEMPLATE_ID) return "";

    const tempFolder = DriveApp.getFolderById(CONFIG.TEMP_FOLDER_ID);
    const finalFolder = DriveApp.getFolderById(CONFIG.FINAL_RECEIPT_FOLDER_ID);
    const templateFile = DriveApp.getFileById(CONFIG.SLIDE_TEMPLATE_ID);

    const fileName = `${data.date}_${data.user}_${data.cardNumber}_영수증_${Date.now()}`;
    const tempSlide = templateFile.makeCopy(fileName, tempFolder);

    try {
      const presentation = SlidesApp.openById(tempSlide.getId());
      const slide = presentation.getSlides()[0];

      slide.replaceAllText("{{사용일자}}", data.date || "");
      slide.replaceAllText("{{사용자}}", data.user || "");
      slide.replaceAllText("{{사용내역}}", data.details || "");
      slide.replaceAllText(
        "{{금액}}",
        data.amount ? Number(data.amount).toLocaleString() + "원" : "0원"
      );

      if (data.image) {
        const b64Data = data.image.includes("base64,")
          ? data.image.split("base64,")[1]
          : data.image;

        const imageBlob = Utilities.newBlob(
          Utilities.base64Decode(b64Data),
          "image/jpeg"
        );

        const shapes = slide.getShapes();
        for (let i = 0; i < shapes.length; i++) {
          if (shapes[i].getTitle() === "{{영수증_이미지}}") {
            const frame = shapes[i];
            const img = slide.insertImage(imageBlob);

            img.setLeft(frame.getLeft());
            img.setTop(frame.getTop());
            img.setWidth(frame.getWidth());
            img.setHeight(frame.getHeight());

            frame.remove();
            break;
          }
        }
      }

      presentation.saveAndClose();

      const thumbnailUrl = Slides.Presentations.Pages.getThumbnail(
        presentation.getId(),
        slide.getObjectId(),
        {
          "thumbnailProperties.thumbnailSize": "LARGE"
        }
      ).contentUrl;

      const finalImageFile = finalFolder
        .createFile(UrlFetchApp.fetch(thumbnailUrl).getBlob())
        .setName(fileName + ".jpg");

      return finalImageFile.getUrl();
    } catch (e) {
      console.error("SlideService.createReceiptImage failed:", e);
      return "";
    } finally {
      tempSlide.setTrashed(true);
    }
  }
};

const SheetService = {
  getSS: function () {
    let ss = null;

    try {
      ss = SpreadsheetApp.getActiveSpreadsheet();
    } catch (e) {}

    if (!ss) {
      ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    }

    return ss;
  },

  getSheet: function (name) {
    return this.getSS().getSheetByName(name);
  },

  getNextDataRow: function (sheet, col) {
    const lastRow = sheet.getLastRow();
    if (lastRow < 1) return 1;

    const values = sheet.getRange(1, col, lastRow, 1).getValues();
    for (let i = values.length - 1; i >= 0; i--) {
      if (values[i][0] !== "" && values[i][0] !== null) {
        return i + 2;
      }
    }

    return 1;
  },

  safeWriteRow: function (sheet, rowIndex, values11) {
    const range = sheet.getRange(rowIndex, 1, 1, 11);
    range.clearContent();
    range.setValues([values11]);
  },

  handleOnEdit: function (e) {
    if (!e || !e.range) return;

    const sheet = e.range.getSheet();
    if (sheet.getName() !== CONFIG.SHEET_NAMES.MAIN) return;

    const startRow = e.range.getRow();
    const numRows = e.range.getNumRows ? e.range.getNumRows() : 1;

    if (startRow <= 1) return;
    if (e.range.getColumn() !== 11) return;

    const values = e.range.getValues ? e.range.getValues() : [[e.value]];
    const targetRows = [];

    for (let i = 0; i < numRows; i++) {
      const rowNumber = startRow + i;
      if (rowNumber <= 1) continue;

      const v = values[i] && values[i][0];
      if (v === true || v === "TRUE") {
        targetRows.push(rowNumber);
      }
    }

    if (targetRows.length === 0) return;

    let ok = false;

    try {
      const ui = SpreadsheetApp.getUi();
      const msg = targetRows.length === 1
        ? "선택한 1개 행을 삭제할까요?\n(되돌릴 수 없습니다)"
        : `선택한 ${targetRows.length}개 행을 삭제할까요?\n(되돌릴 수 없습니다)`;

      const res = ui.alert("삭제 확인", msg, ui.ButtonSet.OK_CANCEL);
      ok = res === ui.Button.OK;
    } catch (err) {
      ok = false;
    }

    if (!ok) {
      try {
        e.range.setValue(false);
      } catch (_) {
        try {
          e.range.setValues(values.map(() => [false]));
        } catch (__) {}
      }
      return;
    }

    targetRows
      .sort((a, b) => b - a)
      .forEach(r => this._deleteRowAndResetStatus(sheet, r));
  },

  _deleteRowAndResetStatus: function (sheet, row) {
    try {
      const cardId = String(sheet.getRange(row, 4).getValue() || "").trim();

      if (cardId) {
        const parentSS = sheet.getParent();
        const statusSheet = parentSS.getSheetByName(CONFIG.SHEET_NAMES.STATUS);
        const rowIndex = this.findRowIndexByCardId(statusSheet, cardId);

        if (rowIndex > 0) {
          statusSheet
            .getRange(rowIndex, 2, 1, 4)
            .setValues([[CONFIG.CARD_STATUS.AVAILABLE, "", "", ""]]);
        }
      }

      sheet.deleteRow(row);
    } catch (err) {
      try {
        sheet.getRange(row, 11).setValue(false);
      } catch (e) {}

      throw err;
    }
  },

  findRowIndexByCardId: function (sheet, cardId) {
    const data = sheet.getDataRange().getValues();

    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0]).trim() === String(cardId).trim()) {
        return i + 1;
      }
    }

    return -1;
  }
};

const GeminiService = {
  analyzeReceipt: function (base64Image) {
    if (!CONFIG.GEMINI_API_KEY) {
      return {
        ok: false,
        error: "API_KEY_MISSING",
        storeName: "",
        amount: "",
        date: ""
      };
    }

    const prompt = 'Extract 1.storeName 2.amount(digits) 3.date(YYYY-MM-DD). JSON: { "storeName": "", "amount": "", "date": "" }';

    const requestBody = {
      contents: [{
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: "image/jpeg",
              data: (base64Image.split("base64,")[1] || base64Image)
            }
          }
        ]
      }]
    };

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${CONFIG.GEMINI_API_KEY}`;

        const response = UrlFetchApp.fetch(url, {
          method: "post",
          contentType: "application/json",
          payload: JSON.stringify(requestBody),
          muteHttpExceptions: true
        });

        const statusCode = response.getResponseCode();
        if (statusCode < 200 || statusCode >= 300) {
          throw new Error(`HTTP_${statusCode}`);
        }

        const parsed = JSON.parse(response.getContentText() || "{}");
        const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error("EMPTY_RESPONSE");

        const cleaned = String(text)
          .replace(/```json/g, "")
          .replace(/```/g, "")
          .trim();

        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("JSON_NOT_FOUND");

        const result = JSON.parse(jsonMatch[0]);

        return {
          ok: true,
          error: "",
          storeName: String(result.storeName || "").trim(),
          amount: String(result.amount || "").trim(),
          date: String(result.date || "").trim()
        };
      } catch (e) {
        console.error(`GeminiService.analyzeReceipt attempt ${attempt} failed: ${e}`);

        if (attempt === 1) {
          Utilities.sleep(1000);
        }
      }
    }

    return {
      ok: false,
      error: "ANALYSIS_FAILED",
      storeName: "",
      amount: "",
      date: ""
    };
  }
};
