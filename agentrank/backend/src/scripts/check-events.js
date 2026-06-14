const { keccak256, toUtf8Bytes } = require("ethers");

const candidates = [
  "NewFeedback(uint256,address,uint64,int128,uint8,string,string,string,string,string,bytes32)",
  "NewFeedback(uint256,address,uint64,int128,uint8,string,string,string,string,string,bytes32,bytes32)",
  "NewFeedback(uint256,address,uint64,int128,uint8,indexed string,string,string,string,string,bytes32)",
  "FeedbackRevoked(uint256,address,uint64)",
  "ResponseAppended(uint256,address,uint64,address,string,bytes32)",
];

for (const c of candidates) {
  console.log(keccak256(toUtf8Bytes(c)), " <= ", c);
}

console.log("");
console.log("Target from BigQuery: 0x6a4a61743519c9d648a14e6493f47dbe3ff1aa29e7785c96c8326a205e58febc");
