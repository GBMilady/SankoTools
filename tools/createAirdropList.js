import fs from 'fs-extra';
import path from 'path';
import csv from 'csv-parser';
import yargs from 'yargs';

const argv = yargs(process.argv.slice(2))
  .option('files', {
    alias: 'f',
    description: 'List of CSV files to read',
    type: 'array',
    demandOption: true,
  })
  .option('total', {
    alias: 't',
    description: 'Total amount to distribute',
    type: 'number',
    demandOption: true,
  })
  .option('equal', {
    description: 'Distribute the total amount equally',
    type: 'boolean',
    conflicts: 'weighted',
  })
  .option('weighted', {
    description: 'Distribute the total amount based on weight',
    type: 'boolean',
    conflicts: 'equal',
  })
  .option('weight-scale', {
    description: 'Weight scale factor between 0.1 and 1 (default: 0.5)',
    type: 'number',
    default: 0.5,
  })
  .option('minimum', {
    description: 'Minimum amount to allocate per address in weighted mode',
    type: 'number',
    default: 0,
  })
  .option('maximum', {
    description: 'Maximum amount to allocate per address in weighted mode',
    type: 'number',
    default: Infinity,
  })
  .demandOption(['total'], 'Please provide both total and either equal or weighted argument')
  .help()
  .alias('help', 'h')
  .argv;

const currentDir = process.cwd();
const outputFileName = 'AirdropRecipients.csv';

const parseCsvFile = (filePath) => {
  return new Promise((resolve, reject) => {
    const data = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => data.push(row))
      .on('end', () => resolve(data))
      .on('error', reject);
  });
};

const calculateWeightedShareForFile = (filePath, scale) => {
  return new Promise((resolve, reject) => {
    const addressMap = new Map();
    const balances = [];

    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => {
        const address = data.Address;
        const balance = parseFloat(data.Balance);
        addressMap.set(address, balance);
        balances.push(balance);
      })
      .on('end', () => {
        const totalBalance = balances.reduce((sum, balance) => sum + balance, 0);
        const weightedBalances = balances.map((balance) => Math.pow(balance / totalBalance, scale));
        const weightedTotal = weightedBalances.reduce((sum, weight) => sum + weight, 0);

        const relativeWeights = new Map();
        Array.from(addressMap.keys()).forEach((address, index) => {
          relativeWeights.set(address, weightedBalances[index] / weightedTotal);
        });

        resolve(relativeWeights);
      })
      .on('error', reject);
  });
};

const mergeRelativeWeights = (fileWeightsArray) => {
  const mergedWeights = new Map();

  fileWeightsArray.forEach((fileWeights) => {
    fileWeights.forEach((weight, address) => {
      if (mergedWeights.has(address)) {
        mergedWeights.set(address, Math.max(mergedWeights.get(address), weight));
      } else {
        mergedWeights.set(address, weight);
      }
    });
  });

  return mergedWeights;
};

const calculateEqualShare = (addresses, total) => {
  const share = total / addresses.length;
  return addresses.map((address) => ({ address, balance: share }));
};

const calculateWeightedShare = (mergedWeights, total, minimum, maximum) => {
  const addresses = Array.from(mergedWeights.keys());
  const weights = Array.from(mergedWeights.values());
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  let remainingTotal = total;
  const adjustedBalances = weights.map((weight) => {
    const baseAmount = total * weight / totalWeight;
    if (baseAmount < minimum) {
      remainingTotal -= minimum;
      return minimum;
    } else if (baseAmount > maximum) {
      remainingTotal -= maximum;
      return maximum;
    } else {
      return baseAmount;
    }
  });

  const remainingWeights = weights.filter((_, index) => adjustedBalances[index] !== minimum && adjustedBalances[index] !== maximum);
  const remainingWeightTotal = remainingWeights.reduce((sum, weight) => sum + weight, 0);

  const finalBalances = adjustedBalances.map((balance, index) => {
    if (balance >= minimum || balance <= maximum) {
      return balance;
    } else {
      return ((remainingTotal * weights[index]) / remainingWeightTotal);
    }
  });

  return addresses.map((address, index) => ({
    address,
    balance: parseFloat(finalBalances[index].toFixed(18)),
  }));
};

const adjustForTotal = (result, total) => {
  let totalDistributed = result.reduce((sum, { balance }) => sum + balance, 0);
  let discrepancy = total - totalDistributed;

  while (Math.abs(discrepancy) > 0.000000000000001) {
    const randomIndex = Math.floor(Math.random() * result.length);
    result[randomIndex].balance += discrepancy;
    totalDistributed = result.reduce((sum, { balance }) => sum + balance, 0);
    discrepancy = total - totalDistributed;
  }

  return result;
};

const saveToCSV = (data, outputFilePath) => {
  const csvData = data.map(({ address, balance }) => `${address},${balance}`).join('\n');
  fs.writeFileSync(outputFilePath, csvData);
};

(async () => {
  try {
    const { files, total, equal, weighted, weightScale, minimum, maximum } = argv;

    const validFiles = files.filter((filePath) => path.basename(filePath) !== outputFileName);

    let result;

    if (equal) {
      const allAddresses = new Set();

      for (const filePath of validFiles) {
        const fileData = await parseCsvFile(filePath);
        fileData.forEach(({ Address }) => {
          allAddresses.add(Address);
        });
      }

      result = calculateEqualShare(Array.from(allAddresses), total);
    } else if (weighted) {
      const fileWeightsArray = await Promise.all(
        validFiles.map((filePath) => calculateWeightedShareForFile(filePath, weightScale))
      );

      const mergedWeights = mergeRelativeWeights(fileWeightsArray);

      result = calculateWeightedShare(mergedWeights, total, minimum, maximum);
    } else {
      throw new Error('Either --equal or --weighted must be specified');
    }

    result = adjustForTotal(result, total);

    saveToCSV(result, path.join(currentDir, outputFileName));

    const totalDistributed = result.reduce((sum, { balance }) => sum + balance, 0).toFixed(18);
    console.log(`Airdrop recipients saved to AirdropRecipients.csv`);
    console.log(`Number of recipients: ${result.length}`);
    console.log(`Total distributed: ${totalDistributed}`);
  } catch (error) {
    console.error('Error processing CSV files:', error);
  }
})();
