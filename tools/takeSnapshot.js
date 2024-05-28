import { ethers } from 'ethers';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import cliProgress from 'cli-progress';
import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import sanko from './util/sanko.js';

const currentDir = process.cwd();

const argv = yargs(hideBin(process.argv))
  .version(false)
  .option('contract', {
    alias: 'c',
    description: 'Contract address of the ERC20, ERC721, or ERC1155 token',
    type: 'string',
    demandOption: true
  })
  .option('debug', {
    description: 'Enable debug output',
    type: 'boolean',
    default: false
  })
  .option('block', {
    alias: 'b',
    description: 'Contract deployment block (if known)',
    type: 'number',
    default: 0
  })
  .option('csv', {
    description: 'Save holder snapshot in CSV format',
    type: 'boolean',
    default: false
  })
  .option('refresh', {
    description: 'Refresh holder data from the first block if snapshot data already exists',
    type: 'boolean',
    default: false
  })
  .help()
  .alias('help', 'h')
  .argv;

const jsonRpcUrl = "https://mainnet.sanko.xyz";
const provider = new ethers.JsonRpcProvider(jsonRpcUrl, sanko);

const contractAddress = argv.contract;
const debug = argv.debug;
const startingBlock = argv['block'];
const outputCsv = argv.csv;
const refreshData = argv['refresh'];

console.log(chalk.cyan(`Contract Address: ${chalk.bold(contractAddress)}\n`));

async function checkBlockForDeployment(contractAddress, blockNumber) {
  try {
    const block = await provider.getBlock(blockNumber, true);

    if (debug) console.log(block);

    for (const tx of block.prefetchedTransactions) {
      if (debug) console.log(tx);
      if (tx.to === null) {
        const receipt = await provider.getTransactionReceipt(tx.hash);
        if (receipt.contractAddress === contractAddress) {
          return true;
        }
      }
    }
  } catch (error) {
    console.error(chalk.red(`Error checking block ${blockNumber}:`), error);
  }

  return false;
}

async function getDeploymentBlock(contractAddress) {
  const latestBlockNumber = await provider.getBlockNumber();
  const progressBar = new cliProgress.SingleBar({
    format: ` ${chalk.green('{bar}')} | {percentage}% | {value}/{total} Blocks Scanned`
  }, cliProgress.Presets.shades_classic);

  console.log(chalk.cyan(`Scanning chain history for contract deployment\n`));
  progressBar.start(latestBlockNumber - startingBlock + 1, 0);

  for (let blockNumber = startingBlock; blockNumber <= latestBlockNumber; blockNumber++) {
    if (await checkBlockForDeployment(contractAddress, blockNumber)) {
      progressBar.setTotal(blockNumber);
      progressBar.update(blockNumber);
      progressBar.stop();
      console.log(chalk.green(`\nFound! Deployment Block: ${blockNumber}\n`));
      return blockNumber;
    }

    progressBar.increment();
  }

  progressBar.stop();
  console.log(chalk.red("\nCouldn't find contract deployment. Make sure you provided the correct CA and block matching/prior to deployment\n"));
  return null;
}

async function verifyDeploymentBlock(contractAddress, deploymentBlock) {
  if (await checkBlockForDeployment(contractAddress, deploymentBlock)) return true;
  console.log(chalk.red("\nCouldn't verify deployment block in cache.\n"));
  return false;
}

async function getCurrentBlock() {
  const blockNumber = await provider.getBlockNumber();
  if (debug) console.log(chalk.cyan(`Current Block: ${blockNumber}\n`));
  return blockNumber;
}

async function getPastEvents(contract, eventName, fromBlock, toBlock, progressBar) {
  const events = [];
  const batchSize = 1000;

  for (let i = fromBlock; i <= toBlock; i += batchSize) {
    const endBlock = Math.min(i + batchSize - 1, toBlock);
    if (debug) console.log(chalk.cyan(`Fetching events from block ${i} to ${endBlock}`));
    const newEvents = await contract.queryFilter(eventName, i, endBlock);
    events.push(...newEvents);
    progressBar.increment(batchSize);
  }

  progressBar.setTotal(toBlock - fromBlock);
  progressBar.update(toBlock - fromBlock);

  return events;
}

function formatBigIntToDecimal(bigIntValue) {
  const strValue = bigIntValue.toString();
  const paddedValue = strValue.padStart(19, '0');
  const integerPart = paddedValue.slice(0, -18);
  const decimalPart = paddedValue.slice(-18);
  return `${integerPart}.${decimalPart}`;
}

async function getERC20Holders(contractAddress, fromBlock, toBlock, progressBar) {
  const abi = [
    "event Transfer(address indexed from, address indexed to, uint256 value)"
  ];
  const contract = new ethers.Contract(contractAddress, abi, provider);
  const transferEvents = await getPastEvents(contract, "Transfer", fromBlock, toBlock, progressBar);

  const balances = {};

  transferEvents.forEach(event => {
    const { from, to, value } = event.args;
    const valueBigInt = BigInt(value.toString());

    if (from !== ethers.ZeroAddress) {
      if (!balances[from]) balances[from] = 0n;
      balances[from] -= valueBigInt;
    }
    if (to !== ethers.ZeroAddress) {
      if (!balances[to]) balances[to] = 0n;
      balances[to] += valueBigInt;
    }
  });

  return balances;
}

async function getERC721Holders(contractAddress, fromBlock, toBlock, progressBar) {
  const abi = [
    "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
  ];
  const contract = new ethers.Contract(contractAddress, abi, provider);
  const transferEvents = await getPastEvents(contract, "Transfer", fromBlock, toBlock, progressBar);

  const tokenOwners = {};

  transferEvents.forEach(event => {
    const { from, to, tokenId } = event.args;
    if (from !== ethers.ZeroAddress) delete tokenOwners[tokenId.toString()];
    if (to !== ethers.ZeroAddress) tokenOwners[tokenId.toString()] = to;
  });

  const holderCounts = {};

  Object.values(tokenOwners).forEach(owner => {
    if (!holderCounts[owner]) holderCounts[owner] = 0;
    holderCounts[owner]++;
  });

  return holderCounts;
}

async function getERC1155Holders(contractAddress, fromBlock, toBlock, progressBar) {
  const abi = [
    "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)",
    "event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)"
  ];
  const contract = new ethers.Contract(contractAddress, abi, provider);

  const singleTransferEvents = await getPastEvents(contract, "TransferSingle", fromBlock, toBlock, progressBar);
  const batchTransferEvents = await getPastEvents(contract, "TransferBatch", fromBlock, toBlock, progressBar);

  const balances = {};

  singleTransferEvents.forEach(event => {
    const { from, to, id, value } = event.args;
    const valueBigInt = BigInt(value.toString());

    if (from !== ethers.ZeroAddress) {
      if (!balances[from]) balances[from] = {};
      if (!balances[from][id.toString()]) balances[from][id.toString()] = 0n;
      balances[from][id.toString()] -= valueBigInt;
    }
    if (to !== ethers.ZeroAddress) {
      if (!balances[to]) balances[to] = {};
      if (!balances[to][id.toString()]) balances[to][id.toString()] = 0n;
      balances[to][id.toString()] += valueBigInt;
    }
  });

  batchTransferEvents.forEach(event => {
    const { from, to, ids, values } = event.args;
    ids.forEach((id, index) => {
      const valueBigInt = BigInt(values[index].toString());
      const idStr = id.toString();

      if (from !== ethers.ZeroAddress) {
        if (!balances[from]) balances[from] = {};
        if (!balances[from][idStr]) balances[from][idStr] = 0n;
        balances[from][idStr] -= valueBigInt;
      }
      if (to !== ethers.ZeroAddress) {
        if (!balances[to]) balances[to] = {};
        if (!balances[to][idStr]) balances[to][idStr] = 0n;
        balances[to][idStr] += valueBigInt;
      }
    });
  });

  const holders = {};
  for (const address in balances) {
    for (const id in balances[address]) {
      if (!holders[address]) holders[address] = 0n;
      holders[address] += balances[address][id];
    }
  }

  return holders;
}

const ERC721_INTERFACE_ID = "0x80ac58cd";
const ERC1155_INTERFACE_ID = "0xd9b67a26";
const erc165Abi = [
  "function supportsInterface(bytes4 interfaceID) external view returns (bool)"
];

async function supportsInterface(contractAddress, interfaceId) {
  const contract = new ethers.Contract(contractAddress, erc165Abi, provider);
  try {
    return await contract.supportsInterface(interfaceId);
  } catch (error) {
    return false;
  }
}

async function detectContractType(contractAddress) {
  if (await supportsInterface(contractAddress, ERC721_INTERFACE_ID)) {
    console.log(chalk.cyan(`Looks like an ${chalk.bold('ERC721')} type contract...\n`));
    return 'ERC721';
  }

  if (await supportsInterface(contractAddress, ERC1155_INTERFACE_ID)) {
    console.log(chalk.cyan(`Looks like an ${chalk.bold('ERC1155')} type contract...\n`));
    return 'ERC1155';
  }

  const erc20Abi = ["function allowance(address owner, address spender) view returns (uint256)"];
  if (await checkContractMethod(contractAddress, erc20Abi)) {
    console.log(chalk.cyan(`Looks like an ${chalk.bold('ERC20')} type contract...\n`));
    return 'ERC20';
  }

  return false;
}

async function checkContractMethod(contractAddress, abi) {
  const contract = new ethers.Contract(contractAddress, abi, provider);
  const methodToCall = contract.interface.fragments[0];
  const method = contract.getFunction(methodToCall);

  try {
    await method.staticCall(...Array(methodToCall.inputs.length).fill(ethers.ZeroAddress));
    return true;
  } catch (error) {
    return false;
  }
}

async function getTokenInfo(contractAddress) {
  try {
    const abi = [
      "function name() view returns (string)",
      "function symbol() view returns (string)"
    ];
    const contract = new ethers.Contract(contractAddress, abi, provider);
    const [name, symbol] = await Promise.all([contract.name(), contract.symbol()]);
    return { name, symbol };
  } catch (error) {
    console.error(chalk.red(`Error fetching token info for contract ${contractAddress}:`), error);
    return false;
  }
}

async function isContract(address) {
  const code = await provider.getCode(address);
  return code !== '0x';
}

function commify(value) {
  const match = value.match(/^(-?)([0-9]*)(\.?)([0-9]*)$/);
  if (!match || (!match[2] && !match[4])) {
    throw new Error(`bad formatted number: ${ JSON.stringify(value) }`);
  }

  const neg = match[1];
  const whole = BigInt(match[2] || 0).toLocaleString("en-us");
  const frac = match[4] ? match[4].match(/^(.*?)0*$/)[1]: "0";

  return `${ neg }${ whole }.${ frac }`;
}

async function main() {
  const token = await getTokenInfo(contractAddress);

  if (!token) return false;

  console.log(chalk.cyan(`Token found: ${chalk.yellow.bold(token.symbol)} - ${chalk.bold(token.name)}\n`));

  const outputFilePath = path.join(currentDir, `${token.symbol}-${contractAddress}.json`);
  
  let existingHolders = {};
  let fromBlock = startingBlock;
  let contractDeploymentBlock;

  if (fs.existsSync(outputFilePath)) {
    const data = fs.readJsonSync(outputFilePath);

    existingHolders = data.holders.reduce((acc, [address, balance]) => {
      acc[address] = BigInt(String(balance).replace('.', ''));
      return acc;
    }, {});

    if (data.deploymentBlock) {
      const isValid = await verifyDeploymentBlock(contractAddress, data.deploymentBlock);

      if (isValid) {
        if (refreshData) fromBlock = data.deploymentBlock;
        if (!refreshData) console.log(chalk.cyan(`Found previous snapshot, fast-forwarding to block ${data.lastCheckedBlock}...\n`));
        if (!refreshData) fromBlock = data.lastCheckedBlock;
        contractDeploymentBlock = data.deploymentBlock;
      } else {
        contractDeploymentBlock = await getDeploymentBlock(contractAddress);
      }
    }
  } else {
    if (!startingBlock || startingBlock === 0) {
      console.log(chalk.red(`No deployment block specified, this is not recommended and searching all chain history will take a long time.\n`));
    }
    
    contractDeploymentBlock = await getDeploymentBlock(contractAddress);
    fromBlock = contractDeploymentBlock;
  }

  const currentBlock = await getCurrentBlock();
  const totalBlocks = currentBlock - fromBlock + 1;
  let progressBar = new cliProgress.SingleBar({
    format: ` ${chalk.green('{bar}')} | {percentage}% | {value}/{total} Blocks Processed`
  }, cliProgress.Presets.shades_classic);

  let holders;
  let totalTransactions = 0;
  let uniqueHolders = new Set();

  try {
    const contractType = await detectContractType(contractAddress, token.symbol);

    if (!contractType) throw new Error(`Unknown token type or contract not conforming to ERC20, ERC721, or ERC1155 standards`);

    console.log(chalk.cyan(`Checking transaction history...\n`));

    progressBar.start(totalBlocks, 0);

    switch (contractType) {
      case 'ERC20':
        holders = await getERC20Holders(contractAddress, fromBlock, currentBlock, progressBar);
        break;
      case 'ERC721':
        holders = await getERC721Holders(contractAddress, fromBlock, currentBlock, progressBar);
        break;
      case 'ERC1155':
        holders = await getERC1155Holders(contractAddress, fromBlock, currentBlock, progressBar);
        break;
    }

    progressBar.stop();

    for (const [holder, balance] of Object.entries(existingHolders)) {
      if (contractType === 'ERC20') {
        existingHolders[holder] = formatBigIntToDecimal(balance);
      } else {
        existingHolders[holder] = Number(balance);
      }
    }

    console.log(chalk.cyan(`\nCleaning up contracts from holder list...\n`));

    progressBar = new cliProgress.SingleBar({
      format: ` ${chalk.green('{bar}')} | {percentage}% | {value}/{total} Addresses Checked`
    }, cliProgress.Presets.shades_classic);
  

    progressBar.start(Object.entries(holders).length, 0);

    for (const [holder, balance] of Object.entries(holders)) {
      totalTransactions++;
      progressBar.increment(1);
      uniqueHolders.add(holder);
      if (balance !== 0n && !(await isContract(holder))) {
        if (contractType === 'ERC20') {
          existingHolders[holder] = formatBigIntToDecimal(balance);
        } else {
          existingHolders[holder] = Number(balance);
        }
      } else {
        delete existingHolders[holder];
      }
    }


    const sortedHolders = Object.entries(existingHolders).sort(([, a], [, b]) => parseFloat(b) - parseFloat(a));

    fs.writeJsonSync(outputFilePath, { holders: sortedHolders, lastCheckedBlock: currentBlock, deploymentBlock: contractDeploymentBlock, symbol: token.symbol }, { spaces: 2 });

    if (outputCsv) {
      const csvFilePath = path.join(currentDir, `${token.symbol}-${contractAddress}.csv`);
      const csvData = sortedHolders.map(([holder, balance]) => `${holder},${balance}`).join('\n');
      fs.writeFileSync(csvFilePath, `Address,Balance\n${csvData}`);
      console.log(chalk.green(`\n\nSnapshot saved\n${chalk.bold(`${token.symbol}-${contractAddress}.csv\n${token.symbol}-${contractAddress}.json`)}`));
    } else {
      console.log(chalk.green(`\n\nSnapshot saved\n${chalk.bold(`${token.symbol}-${contractAddress}.json`)}`));
    }

    console.log(chalk.bold(`\nTx count since last snapshot: `) + chalk.blue(totalTransactions));
    console.log(chalk.bold(`Unique traders since last snapshot: `) + chalk.blue(uniqueHolders.size));
    console.log(chalk.bold(`Current holders: `) + chalk.blue(sortedHolders.length));
    console.log(chalk.bold(`Top 10 holders:`));
    sortedHolders.slice(0, 10).forEach(([holder, balance], index) => {
      console.log(`${chalk.magenta(holder)}: ${chalk.bold.yellow(commify(balance.toString()))} ${chalk.yellowBright(token.symbol)}`);
    });

    process.exit(0);
  } catch (error) {
    progressBar.stop();

    console.error(chalk.red(error));
    process.exit(1);
  }

  return false;
}

main();
