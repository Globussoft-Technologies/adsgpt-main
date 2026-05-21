const basicAuth = require("basic-auth");
exports.auth = (req, res, next) => {
  const USERNAME = process.env.USER_NAME;
  const PASSWORD = process.env.PASSWORD;
  const user = basicAuth(req);

  if (!user || user.name !== USERNAME || user.pass !== PASSWORD) {
    res.set("WWW-Authenticate", 'Basic realm="API Documentation"');
    return res.status(401).send("Authentication required.");
  }

  next();
};
