import { ethers } from 'ethers';
import csv from 'csv-parser';
import fs from 'fs';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import cliProgress from 'cli-progress';
import dotenv from 'dotenv';
import sanko from './util/sanko.js';

dotenv.config();

const argv = yargs(hideBin(process.argv))
  .version(false)
  .option('token', {
    alias: 't',
    description: 'The contract address of the ERC20, ERC721, or ERC1155 tokens you want to airdrop',
    type: 'string',
    demandOption: true
  })
  .option('to', {
    alias: 'f',
    description: 'CSV file with wallet addresses and token amounts (or token IDs for ERC721 and ERC1155)',
    type: 'string',
    demandOption: true
  })
  .option('erc20', {
    description: 'Airdrop ERC20',
    type: 'boolean',
    conflicts: ['erc721', 'erc1155']
  })
  .option('erc721', {
    description: 'Airdrop ERC721 (NFT)',
    type: 'boolean',
    conflicts: ['erc20', 'erc1155']
  })
  .option('erc1155', {
    description: 'Airdrop ERC1155 (NFT)',
    type: 'boolean',
    conflicts: ['erc20', 'erc721']
  })
  .option('batch', {
    alias: 'b',
    description: 'Number of transfers to batch in a single tx',
    type: 'number',
    default: 500,
    coerce: (arg) => {
        if (arg < 1 || arg > 2000) {
            throw new Error('Batch size must be between 1 and 2000');
        }
        return arg;
    }
  })
  .check(argv => {
    if (!argv.erc20 && !argv.erc721 && !argv.erc1155) {
      throw new Error('One of --erc20, --erc721, or --erc1155 must be specified');
    }
    return true;
  })
  .help()
  .alias('help', 'h')
  .argv;

const jsonRpcUrl = "https://mainnet.sanko.xyz";
const provider = new ethers.JsonRpcProvider(jsonRpcUrl, sanko, { staticNetwork: sanko });

const privateKey = process.env.PRIVATE_KEY;
if (!privateKey) {
  throw new Error("Private key not found in .env file");
}
const wallet = new ethers.Wallet(privateKey, provider);

const tokenAddress = argv.token;
const contractAddress = '0x3ef149697ebde1e329184c7c4b56179538631a41';
const gasliteDropAbi = [
  "function airdropERC20(address _token, address[] calldata _addresses, uint256[] calldata _amounts, uint256 _totalAmount) external payable",
  "function airdropERC721(address _nft, address[] calldata _addresses, uint256[] calldata _tokenIds) external payable",
  "function airdropERC1155(address _token, address[] calldata _addresses, uint256[] calldata _ids, uint256[] calldata _amounts, bytes calldata _data) external payable"
];

const gasliteDropContract = new ethers.Contract(contractAddress, gasliteDropAbi, wallet);

async function setAllowance(totalAmount) {
  const tokenAbi = [
    "function approve(address spender, uint256 amount) public returns (bool)"
  ];
  const tokenContract = new ethers.Contract(tokenAddress, tokenAbi, wallet);

  try {
    const tx = await tokenContract.approve(contractAddress, totalAmount);
    console.log(`Approval transaction sent: ${tx.hash}`);
    await tx.wait();
    console.log('Token allowance set successfully.');
  } catch (error) {
    console.error('Error setting token allowance:', error);
  }
}

async function airdropERC20(recipients, batchSize, progressBar) {
  for (let i = 0; i < recipients.length; i += batchSize) {
    const batch = recipients.slice(i, i + batchSize);
    const addresses = batch.map(recipient => recipient.address);
    const amounts = batch.map(recipient => ethers.parseUnits(recipient.amount, 18));
    const totalAmount = amounts.reduce((acc, amount) => acc.add(amount), BigInt(0));
    
    try {
      const tx = await gasliteDropContract.airdropERC20(tokenAddress, addresses, amounts, totalAmount);
      console.log(`Airdrop transaction sent: ${tx.hash}`);
      await tx.wait();
      console.log('Airdrop completed successfully.');
    } catch (error) {
      console.error('Error during airdrop:', error);
    }

    progressBar.increment(batch.length);
  }
}

async function airdropERC721(recipients, batchSize, progressBar) {
  for (let i = 0; i < recipients.length; i += batchSize) {
    const batch = recipients.slice(i, i + batchSize);
    const addresses = batch.map(recipient => recipient.address);
    const tokenIds = batch.map(recipient => recipient.tokenId);
    
    try {
      const tx = await gasliteDropContract.airdropERC721(tokenAddress, addresses, tokenIds);
      console.log(`Airdrop transaction sent: ${tx.hash}`);
      await tx.wait();
      console.log('Airdrop completed successfully.');
    } catch (error) {
      console.error('Error during airdrop:', error);
    }

    progressBar.increment(batch.length);
  }
}

async function airdropERC1155(recipients, batchSize, progressBar) {
  for (let i = 0; i < recipients.length; i += batchSize) {
    const batch = recipients.slice(i, i + batchSize);
    const addresses = batch.map(recipient => recipient.address);
    const ids = batch.map(recipient => recipient.tokenId);
    const amounts = batch.map(recipient => ethers.parseUnits(recipient.amount, 18));
    
    try {
      const tx = await gasliteDropContract.airdropERC1155(tokenAddress, addresses, ids, amounts, "0x");
      console.log(`Airdrop transaction sent: ${tx.hash}`);
      await tx.wait();
      console.log('Airdrop completed successfully.');
    } catch (error) {
      console.error('Error during airdrop:', error);
    }

    progressBar.increment(batch.length);
  }
}

function readRecipientsFromCSV(filePath, type) {
  return new Promise((resolve, reject) => {
    const recipients = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => {
        if (type === 'erc20') {
          recipients.push({ address: row.address, amount: row.amount });
        } else if (type === 'erc721') {
          recipients.push({ address: row.address, tokenId: row.tokenId });
        } else if (type === 'erc1155') {
          recipients.push({ address: row.address, tokenId: row.tokenId, amount: row.amount });
        }
      })
      .on('end', () => {
        resolve(recipients);
      })
      .on('error', reject);
  });
}

(async () => {
  try {
    const type = argv.erc20 ? 'erc20' : argv.erc721 ? 'erc721' : 'erc1155';
    const recipients = await readRecipientsFromCSV(argv.to, type);

    const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    progressBar.start(recipients.length, 0);

    const batchSize = argv.batch ? argv.batch : 500;

    if (type === 'erc20') {
      const totalAmount = recipients.reduce((acc, recipient) => acc.add(ethers.parseUnits(recipient.amount, 18)), BigInt(0));
      await setAllowance(totalAmount);
      await airdropERC20(recipients, batchSize, progressBar);
    } else if (type === 'erc721') {
      await airdropERC721(recipients, batchSize, progressBar);
    } else if (type === 'erc1155') {
      await airdropERC1155(recipients, batchSize, progressBar);
    }

    progressBar.stop();
  } catch (error) {
    console.error('Error airdropping tokens:', error);
  }
})();
