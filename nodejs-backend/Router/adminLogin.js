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
        username.trim() == process.env.UI_USERNAME &&
        password == process.env.UI_PASSWORD
      ) {
        const token = generateToken({username}, process.env.JWT_SECRET_KEY)
        req.session.authenticated = true;
        req.session.username = username;
        req.session.token = token;
        res.redirect("/adsgpt/user-intreaction-data/ui-view");
      } else {
        res.render("login", { error: "Invalid username or password" });
      }
    });

module.exports = router;