const basicAuth = require("basic-auth");
require('dotenv').config();

exports.SwaggerGatewayauth = (req, res, next) => {
  const USERNAME = process.env.SOCKET_USER_NAME;
  const PASSWORD = process.env.SOCKET_PASSWORD;
  const user = basicAuth(req);

  if (!user || user.name !== USERNAME || user.pass !== PASSWORD) {
    res.set("WWW-Authenticate", 'Basic realm="API Documentation"');
    return res.status(401).send("Authentication required.");
  }

  next();
};

