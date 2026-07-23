const { verifyTokenSocket } = require('../services/authService');
const { parseCookies } = require('../services/oauth/sessionCheck');

const verifyTokenSocketMain = (socket, next) => {
  const supplied = socket.handshake.auth.token;
  const suppliedToken =
    supplied && supplied !== "null" && supplied !== "undefined" ? supplied : "";
  const cookies = parseCookies(socket.handshake?.headers?.cookie);
  const token =
    suppliedToken ||
    cookies["adsgpt-session"] ||
    cookies["access-token"];
  const sessionId = socket.handshake?.auth?.sessionId ?? ""
  verifyTokenSocket(token, (err, decoded) => {
    if (err) {
      return next(new Error('Authentication error'));
    }
    
    if(decoded?.created_from=="PAS") decoded.user_id = `PAS-${decoded.user_id}`
      if(decoded?.created_from=="GPT") decoded.user_id = `GPT-${decoded.user_id}`
    decoded.token = token
    decoded.sessionId = sessionId ?? ""
    if (decoded.created_from === 'PAS') {
      // Extract the current date from the userSubscriptionType object
      const currentSubscriptionDate = Object.values(decoded.userSubscriptionType)[0];
      
      // Update the userSubscriptionType to have 'PAS' as the key and the same date
      decoded.userSubscriptionType = { 'PAS': currentSubscriptionDate };
    } 
    socket.user = decoded;
    socket.token = token;
    socket.usesLegacyClientToken = Boolean(suppliedToken);
    socket.sessionId = sessionId ?? "";
    socket.join(socket.user.user_id); 
    next();
  });
};

module.exports = {
    verifyTokenSocketMain
};
