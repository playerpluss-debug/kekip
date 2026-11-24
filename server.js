const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
  res.send("KEKIP is running!");
});

app.listen(PORT, () => {
  console.log(`KEKIP running on port ${PORT}`);
});
