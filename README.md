# HPC Token Smart Contracts

Smart contracts for **HPVideo (HPC)** — a decentralized AI video generation platform on BNB Smart Chain.

## Deployed Contract

| Item | Detail |
|------|--------|
| **Token** | HPC (HPVideo Coin) |
| **Standard** | BEP-20 (ERC-20 compatible) |
| **Chain** | BNB Smart Chain (BSC) — ChainID: 56 |
| **Contract** | [`0x96f4aCfFFbE3344F61BEa68f93aFF46A635EEC86`](https://bscscan.com/token/0x96f4aCfFFbE3344F61BEa68f93aFF46A635EEC86) |
| **Total Supply** | 1,000,000,000 HPC (fixed, no mint) |
| **Verification** | [Sourcify Full Match](https://repo.sourcify.dev/contracts/full_match/56/0x96f4aCfFFbE3344F61BEa68f93aFF46A635EEC86/) |

## Contracts

| Contract | Path | LoC | Description |
|----------|------|-----|-------------|
| **HPCToken** | `contracts/token/HPCToken.sol` | 23 | BEP-20 token with fixed 1B supply, ERC20Permit (EIP-2612), ERC20Burnable, Ownable2Step |
| **HPCVesting** | `contracts/vesting/HPCVesting.sol` | 346 | Multi-category vesting engine with configurable TGE unlock, cliff period, and linear release. Supports revocable grants |
| **HPCDistributor** | `contracts/distribution/HPCDistributor.sol` | 86 | Merkle tree based airdrop distribution with expiry recovery mechanism |
| **HPCNodeStaking** | `contracts/staking/HPCNodeStaking.sol` | 290 | GPU node staking with Synthetix StakingRewards pattern, slashing (max 50%), 24h cooldown, 7-day unstake delay |
| **HPCVaultLock** | `contracts/vault/HPCVaultLock.sol` | 140 | 1-year token lock vault with batch deposits. No emergency withdrawal by design |
| **HPCConstants** | `contracts/libraries/HPCConstants.sol` | 49 | Shared constants library: total supply, allocation percentages, time constants |

## Token Allocation

| Category | Amount | % | Vesting |
|----------|--------|---|---------|
| Core Team | 100M | 10% | 12mo cliff, 20mo linear |
| Series A | 100M | 10% | 12mo cliff, 20mo linear |
| Airdrop | 50M | 5% | 100% at TGE |
| Early Participants | 50M | 5% | 12mo cliff, 20mo linear |
| GPU Compute | 250M | 25% | 60mo mining emissions |
| Liquidity | 50M | 5% | 100% at TGE |
| Protocol Foundation | 100M | 10% | 12mo cliff, 20mo linear |
| Ecosystem Growth | 150M | 15% | 11% TGE, 10mo linear |
| Staking Incentives | 70M | 7% | 1.4% TGE, 5mo linear |
| Competitive Mining | 80M | 8% | 1.6% TGE, 5mo linear |

## Tech Stack

- **Solidity** 0.8.24 (EVM target: cancun, optimizer: 200 runs)
- **Hardhat** v2.22+ with TypeScript
- **OpenZeppelin Contracts** v5.1+ (ERC20, ERC20Permit, Ownable2Step, SafeERC20, ReentrancyGuard, MerkleProof)
- **Testing**: Hardhat + Chai + Ethers.js v6

## Security

Audited by **SALUS Security** (March 2026):

- 6 contracts in scope
- 13 findings identified — **all resolved**
- 3 audit rounds: Standard Security, Senior Engineer, Adversarial/Hacker
- 102 unit tests — **all passing**

| Severity | Count | Status |
|----------|-------|--------|
| Critical | 1 | Resolved |
| High | 2 | Resolved |
| Medium | 3 | Resolved |
| Low | 3 | Resolved |
| Informational | 4 | Acknowledged |

Full audit report: [`docs/SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.md)

## Getting Started

### Prerequisites

- Node.js >= 18
- npm >= 9

### Install

```bash
git clone https://github.com/HPVideoLAB/HPC-Contracts.git
cd HPC-Contracts
npm install
```

### Configure

```bash
cp .env.example .env
# Edit .env and add your deployer private key
```

### Compile

```bash
npm run compile
```

### Test

```bash
npm run test
```

### Deploy

```bash
# Token only (BSC Mainnet)
npm run deploy:token:mainnet

# Full ecosystem (BSC Mainnet)
npm run deploy:mainnet
```

## Project Structure

```
contracts/
  token/          HPCToken.sol          BEP-20 token
  vesting/        HPCVesting.sol        Multi-category vesting
  distribution/   HPCDistributor.sol    Merkle airdrop
  staking/        HPCNodeStaking.sol    GPU node staking + rewards
  vault/          HPCVaultLock.sol      1-year lock vault
  libraries/      HPCConstants.sol      Shared constants
scripts/
  deploy.ts                            Full ecosystem deployment
  deploy-token-only.ts                 Token-only deployment
test/
  HPCToken.test.ts                     12 tests
  HPCVesting.test.ts                   27 tests
  HPCDistributor.test.ts               11 tests
  HPCNodeStaking.test.ts               31 tests
  HPCVaultLock.test.ts                 16 tests
```

## Links

- Website: [hpvideo.io](https://hpvideo.io)
- x402 Skills: [hpvideo.io/x402-skills](https://www.hpvideo.io/x402-skills/)
- Telegram: [@HPVideoAI](https://t.me/HPVideoAI)
- Twitter: [@HPVideoAI](https://x.com/HPVideoAI)
- BscScan: [0x96f4aCfFFbE3344F61BEa68f93aFF46A635EEC86](https://bscscan.com/token/0x96f4aCfFFbE3344F61BEa68f93aFF46A635EEC86)

## License

MIT
