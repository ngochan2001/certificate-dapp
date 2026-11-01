require("@nomicfoundation/hardhat-toolbox");

// Tùy chọn: triển khai lên testnet Sepolia (CHƯA được kiểm thử trong dự án này).
//   export SEPOLIA_RPC_URL="https://..."          (đừng commit URL có chứa API key)
//   export DEPLOYER_PRIVATE_KEY="0x..."           (ví TEST, tuyệt đối không dùng ví thật)
//   npx hardhat run scripts/deploy.js --network sepolia
const { SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY } = process.env;

const networks = {
  // Mạng cục bộ: chạy bằng `npm run node` (chainId 31337)
  localhost: { url: "http://127.0.0.1:8545" },
};
if (SEPOLIA_RPC_URL && DEPLOYER_PRIVATE_KEY) {
  networks.sepolia = { url: SEPOLIA_RPC_URL, accounts: [DEPLOYER_PRIVATE_KEY] };
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.26",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks,
};
