require('dotenv').config()
const jwt = require('jsonwebtoken');
const express = require("express"); 
const router = express.Router();

router.get('/login', (req,res)=>{
    res.render("login");
})

const generateToken = (payload, secretKey) => {
  return jwt.sign(payload, secretKey, { algorithm: 'HS512' });
};

router.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (
    username && username.trim() === process.env.UI_USERNAME &&
    password === process.env.UI_PASSWORD
  ) {
    const token = generateToken({ username }, process.env.JWT_SECRET_KEY);
    if (req.session && typeof req.session.regenerate === "function") {
      req.session.regenerate((err) => {
        if (err) return res.render("login", { error: "Session error. Please try again." });
        req.session.authenticated = true;
        req.session.username = username;
        req.session.token = token;
        return res.redirect("/adsgpt/user-intreaction-data/ui-view");
      });
    } else {
      return res.redirect("/adsgpt/user-intreaction-data/ui-view");
    }
  } else {
    res.render("login", { error: "Invalid username or password" });
  }
});

module.exports = router;