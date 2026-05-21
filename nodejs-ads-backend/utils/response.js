// Success response
exports.sendSuccessResponse = (res, data) => {
  return res.status(200).json(data);
};

// Bad request response
exports.sendBadRequestResponse = (res, error, message = "Bad request") => {
  return res.status(400).json({
    status: "fail",
    message,
    error,
  });
};

// Internal server error response
exports.sendInternalServerErrorResponse = (
  res,
  message = "Internal server error"
) => {
  return res.status(500).json({
    status: "error",
    message,
  });
};
