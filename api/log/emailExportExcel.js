const AWS = require("aws-sdk");
const docClient = new AWS.DynamoDB.DocumentClient();
const ExcelJS = require('exceljs');
const { format } = require("date-fns");
const { responseStatus } = require("../../utils/response");

exports.emailExportExcel = async (event, context) => {
  let { appId, startDate, endDate } = event.queryStringParameters || {};

  if (!appId) {
    return responseStatus(400, { message: "Missing app id!" });
  }

  if (startDate && endDate) {
    startDate = parseInt(startDate);
    endDate = parseInt(endDate);
    if (isNaN(startDate) || isNaN(endDate)) {
      return responseStatus(400, { message: "Dates must be integer!" });
    }
  }

  let mailItems;
  try {
    mailItems = await getEmails(appId, startDate, endDate);
    console.log("mailItems: ", mailItems);
  } catch (err) {
    console.log("Error: ", err);
    return responseStatus(500, { message: err });
  }

  let headersTemp;

  const excelData = mailItems.map((item, index) => {
    let data = {
      "Mail Id": item.emailId,
      "App Id": item.appId,
      "Body": item.body ?? "",
      "Click Action": item.clickAction,
      "Created At": format(new Date(item.createdAt * 1000), "yyyy-MM-dd HH:mm"),
      "Updated At": format(new Date(item.updatedAt * 1000), "yyyy-MM-dd HH:mm"),
      "Active": item.isActive,
      "Scheduled": item.isScheduled,
      "Opened": item.opened ?? "",
      "Received": item.received ?? "",
      "Segment Name": item.topicName ?? "",
      "Total Sent": item.totalSent ?? "",
      "Type": item.type ?? "",
    };

    if (index === 0) {
      headersTemp = Object.keys(data);
    }
    return data;
  });

  console.log("excelData: ", excelData);
  console.log("excelData Len: ", excelData.length);

  if (!excelData.length) {
    return responseStatus(400, { message: "No any email data!" });
  }

  const headers = headersTemp;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'smpl';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet("Emails");

  worksheet.columns = headers.map(header => ({
    header: header,
    key: header,
    width: header.length + 5,
  }));

  worksheet.getRow(1).font = {
    bold: true
  };

  excelData.forEach(data => {
    worksheet.addRow(data);
  });

  try {
    const buffer = await workbook.xlsx.writeBuffer();
    const base64Buffer = Buffer.from(buffer).toString("base64");
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Credentials": true,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": "attachment; filename=" + `messages.xlsx`
      },
      isBase64Encoded: true,
      body: base64Buffer
    };
  } catch (err) {
    console.log("Error: ", err);
    return responseStatus(500, { message: err });
  }
};

const getEmails = async (appId, startDate, endDate) => {
  let finalList = [];
  let lastEvaluatedKey;
  const params = {
    TableName: process.env.EMAIL_TABLE,
    IndexName: "appId-index",
    KeyConditionExpression: "#appId = :value",
    ExpressionAttributeValues: { ":value": appId },
    ExpressionAttributeNames: { "#appId": "appId" },
    ScanIndexForward: false
  };

  if (startDate && endDate) {
    params.FilterExpression = "#createdAt BETWEEN :startDate AND :endDate";
    params.ExpressionAttributeNames = {
      ...params.ExpressionAttributeNames,
      "#createdAt": "createdAt"
    };
    params.ExpressionAttributeValues = {
      ...params.ExpressionAttributeValues,
      ":startDate": startDate,
      ":endDate": endDate,
    };
  }

  do {
    const data = await _getEmails(params, lastEvaluatedKey);
    finalList = [...finalList, ...data.Items];
    lastEvaluatedKey = data.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  console.log("Final List", finalList);
  return finalList;
};

const _getEmails = async (params, lastEvaluatedKey) => {
  console.log("get Email -142", lastEvaluatedKey);
  if (lastEvaluatedKey) {
    params.ExclusiveStartKey = lastEvaluatedKey;
  }
  const result = await docClient.query(params).promise();
  console.log("DB results: ", result);
  return result;
};
