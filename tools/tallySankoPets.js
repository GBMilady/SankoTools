import fetch from 'node-fetch';
import fs from 'fs';
import Table from 'cli-table';
import puppeteer from 'puppeteer';

const contractAddress = "0xE3351CE33689dc444B1a45B8f8F447A181D57227";
const jsonRpcUrl = "https://mainnet.sanko.xyz";

const debug = process.argv.includes('--debug');
const refreshAll = process.argv.includes('--refreshall');
const refreshEggs = process.argv.includes('--refresheggs');
const generateImage = process.argv.includes('--image');
const noPremint = process.argv.includes('--no-premint');

const cacheFileName = 'SankoPetCache.json';
let cache = {};

if (fs.existsSync(cacheFileName) && !refreshAll) {
    cache = JSON.parse(fs.readFileSync(cacheFileName, 'utf-8'));
    console.log('Using cached data from', cacheFileName);
} else if (refreshAll) {
    console.log('Refreshing all token data...');
} else {
    console.log('Cache file does not exist. Fetching data for all tokens...');
}

async function queryTokenURI(tokenId) {
    if (cache[tokenId] && !refreshAll && !(refreshEggs && cache[tokenId].attributes.find(attr => attr.trait_type === 'Type' && attr.value === 'Egg'))) {
        if (debug) {
            console.log(`Using cached data for token ID ${tokenId}`);
        }
        return cache[tokenId];
    }

    const data = {
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [
            {
                to: contractAddress,
                data: `0xc87b56dd${parseInt(tokenId).toString(16).padStart(64, '0')}` // 0xc87b56dd is the function selector for tokenURI(uint256)
            },
            'latest'
        ],
        id: 1
    };

    try {
        const response = await fetch(jsonRpcUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });

        const result = await response.json();
        if (result.error) {
            console.error('Error:', result.error);
            return null;
        } else {
            if (debug) {
                console.log('Raw hex result:', result.result);
            }

            // The result will be in hex, so we need to convert it back to a string
            const hexUri = result.result;
            const tokenUri = hexToAscii(hexUri).trim();
            if (debug) {
                console.log('Converted ASCII URI:', tokenUri);
            }

            // Check for the presence of the base64 JSON prefix
            if (tokenUri.includes('data:application/json;base64,')) {
                const base64Json = tokenUri.split(',')[1];
                if (debug) {
                    console.log('Base64 JSON part:', base64Json);
                }

                try {
                    const jsonString = Buffer.from(base64Json, 'base64').toString('utf-8');
                    if (debug) {
                        console.log('Decoded JSON string:', jsonString);
                    }

                    const jsonObject = JSON.parse(jsonString);
                    cache[tokenId] = jsonObject; // Save to cache
                    return jsonObject;
                } catch (e) {
                    console.error('Base64 decoding or JSON parsing error:', e);
                    return null;
                }
            } else {
                console.error('Token URI is not in the expected base64 encoded JSON format.');
                return null;
            }
        }
    } catch (error) {
        console.error('Fetch Error:', error);
        return null;
    }
}

function hexToAscii(hex) {
    let str = '';
    for (let i = 2; i < hex.length; i += 2) {
        const code = parseInt(hex.substr(i, 2), 16);
        if (code > 31 && code < 127) { // Only include printable ASCII characters
            str += String.fromCharCode(code);
        }
    }
    return str.replace(/[^ -~]+/g, ''); // Remove any non-printable characters
}

function calculatePercentages(counts, total) {
    return Object.fromEntries(
        Object.entries(counts).map(([key, count]) => [key, ((count / total) * 100).toFixed(2)])
    );
}

function sortCounts(counts, ascending = false) {
    return Object.entries(counts).sort((a, b) => ascending ? a[1] - b[1] : b[1] - a[1]);
}

async function generateReport() {
    const eggCountByRarity = {};
    const eggCountByRarityAndVariety = {};
    const bunCountByVariety = {};
    const bunCountByRarityAndVariety = {};

    const usingFullCache = fs.existsSync(cacheFileName) && !refreshAll;

    // Determine the starting tokenId based on the noPremint flag
    const startingTokenId = noPremint ? 301 : 1;

    for (let tokenId = startingTokenId; tokenId <= 4444; tokenId++) {
        const metadata = await queryTokenURI(tokenId);

        if (metadata) {
            const typeAttribute = metadata.attributes.find(attr => attr.trait_type === 'Type');
            const rarityAttribute = metadata.attributes.find(attr => attr.trait_type === 'Rarity');
            const varietyAttribute = metadata.attributes.find(attr => attr.trait_type === 'Variety');

            if (typeAttribute && rarityAttribute) {
                if (typeAttribute.value === 'Egg') {
                    if (!eggCountByRarity[rarityAttribute.value]) {
                        eggCountByRarity[rarityAttribute.value] = 0;
                    }
                    eggCountByRarity[rarityAttribute.value]++;

                    if (!eggCountByRarityAndVariety[rarityAttribute.value]) {
                        eggCountByRarityAndVariety[rarityAttribute.value] = {};
                    }
                    if (!eggCountByRarityAndVariety[rarityAttribute.value][varietyAttribute.value]) {
                        eggCountByRarityAndVariety[rarityAttribute.value][varietyAttribute.value] = 0;
                    }
                    eggCountByRarityAndVariety[rarityAttribute.value][varietyAttribute.value]++;
                }

                if (typeAttribute.value === 'Bun') {
                    if (varietyAttribute) {
                        if (!bunCountByVariety[varietyAttribute.value]) {
                            bunCountByVariety[varietyAttribute.value] = 0;
                        }
                        bunCountByVariety[varietyAttribute.value]++;
                        
                        if (!bunCountByRarityAndVariety[rarityAttribute.value]) {
                            bunCountByRarityAndVariety[rarityAttribute.value] = {};
                        }
                        if (!bunCountByRarityAndVariety[rarityAttribute.value][varietyAttribute.value]) {
                            bunCountByRarityAndVariety[rarityAttribute.value][varietyAttribute.value] = 0;
                        }
                        bunCountByRarityAndVariety[rarityAttribute.value][varietyAttribute.value]++;
                    }
                }
            }
        }

        if (!usingFullCache && tokenId % 100 === 0) {
            console.log(`Processed ${tokenId} tokens...`);
        }
    }

    // Save cache to file
    fs.writeFileSync(cacheFileName, JSON.stringify(cache, null, 2), 'utf-8');

    // Calculate total egg count for percentages
    const totalEggCount = Object.values(eggCountByRarity).reduce((sum, count) => sum + count, 0);

    // Sort and calculate percentages
    const sortedEggCountByVariety = [];
    for (const [rarity, varieties] of Object.entries(eggCountByRarityAndVariety)) {
        for (const [variety, count] of Object.entries(varieties)) {
            sortedEggCountByVariety.push([rarity, variety, count, ((count / totalEggCount) * 100).toFixed(2)]);
        }
    }
    sortedEggCountByVariety.sort((a, b) => b[3] - a[3]);

    const sortedBunCountByVariety = sortCounts(bunCountByVariety);
    const percentagesEggCountByRarity = calculatePercentages(eggCountByRarity, totalEggCount);
    const percentagesBunCountByVariety = calculatePercentages(bunCountByVariety, totalEggCount);

    // Create tables
    const eggTable = new Table({ head: ['Rarity', 'Variety', 'Count', 'Percentage'] });
    sortedEggCountByVariety.forEach(([rarity, variety, count, percentage]) => {
        eggTable.push([rarity, variety, count, `${percentage}%`]);
    });

    const bunTable = new Table({ head: ['Tier', 'Species', 'Count', 'Percentage'] });
    sortedBunCountByVariety.forEach(([variety, count]) => {
        const rarity = Object.keys(bunCountByRarityAndVariety).find(r => bunCountByRarityAndVariety[r][variety]);
        bunTable.push([rarity, variety, count, `${percentagesBunCountByVariety[variety]}%`]);
    });

    const rarityTables = [];
    for (const [rarity, varieties] of Object.entries(bunCountByRarityAndVariety)) {
        const rarityTable = new Table({ head: ['Species', 'Count', 'Percentage'] });
        const sortedVarieties = sortCounts(varieties);
        const percentagesVarieties = calculatePercentages(varieties, totalEggCount);
        sortedVarieties.forEach(([variety, count]) => {
            rarityTable.push([variety, count, `${percentagesVarieties[variety]}%`]);
        });
        rarityTables.push({ rarity, table: rarityTable });
    }

    const breakdownTable = new Table({ head: ['Rarity', 'Species', 'Count'] });
    for (const [rarity, varieties] of Object.entries(bunCountByRarityAndVariety)) {
        const sortedVarieties = sortCounts(varieties, true).slice(0, 3); // Sort in ascending order to get the rarest
        sortedVarieties.forEach(([variety, count]) => {
            breakdownTable.push([rarity, variety, count]);
        });
    }

    console.log('\nUnhatched Egg Count by Rarity:');
    console.log(eggTable.toString());
    console.log('\nBun Count by Species:');
    console.log(bunTable.toString());
    rarityTables.forEach(({ rarity, table }) => {
        console.log(`\n${rarity}:`);
        console.log(table.toString());
    });
    console.log('\nRarest 3 by Tier:');
    console.log(breakdownTable.toString());

    return {
        eggTable,
        bunTable,
        rarityTables,
        breakdownTable
    };
}

async function createImage(tables) {
    const rarityColors = {
        Common: 'rgba(144, 238, 144, 0.3)', // light green
        Uncommon: 'rgba(173, 216, 230, 0.3)', // light blue
        Rare: 'rgba(240, 128, 128, 0.3)', // light red
        Rotten: 'rgba(216, 191, 216, 0.3)', // light purple
        Moldy: 'rgba(255, 165, 0, 0.3)', // light orange
        'Super Rare': 'rgba(255, 215, 0, 0.3)' // light gold
    };

    const date = new Date().toLocaleDateString('en-US');

    const htmlContent = `
    <html>
    <head>
        <style>
            body {
                font-family: Arial, sans-serif;
                margin: 0;
                padding: 0;
                background-color: rgba(30, 30, 40, 0.1);
            }
            .container {
                display: grid;
                grid-template-columns: 1fr 1fr 1fr;
                gap: 10px;
                padding: 200px 20px 20px 40px;
                box-sizing: border-box;
                width: 1200px;
            }
            .table-container {
                box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
                border-radius: 8px;
                overflow: hidden;
                background: white;
            }
            table {
                width: 100%;
                border-collapse: collapse;
                margin: 0;
            }
            th, td {
                border: 1px solid #ddd;
                padding: 8px;
                text-align: left;
            }
            th {
                background-color: #f4f4f4;
            }
            td:last-child {
                text-align: right;
            }
            h3 {
                margin: 0;
                padding: 10px;
                background-color: #f4f4f4;
                text-align: center;
            }
            .title {
                position: absolute;
                top: 0;
                width: 1200px;
                padding: 10px;
                text-align: center;
                font-size: 64px;
                text-transform: uppercase;
                font-family: 'Comic Sans MS';
            }
        </style>
    </head>
    <body>
        <div class="title">Sanko Pets Bun Breakdown<br/>${date}</div>
        <div class="container">
            <div class="table-container">
                <h3>Bun Count by Species</h3>
                <table>${generateHTMLTable(tables.bunTable, rarityColors)}</table>
            </div>
            <div class="table-container">
                <h3>Common</h3>
                <table>${generateHTMLTable(tables.rarityTables.find(({ rarity }) => rarity === 'Common').table, rarityColors, 'Common')}</table>
                <h3>Uncommon</h3>
                <table>${generateHTMLTable(tables.rarityTables.find(({ rarity }) => rarity === 'Uncommon').table, rarityColors, 'Uncommon')}</table>
                <h3>Rare</h3>
                <table>${generateHTMLTable(tables.rarityTables.find(({ rarity }) => rarity === 'Rare').table, rarityColors, 'Rare')}</table>
                <h3>Rotten</h3>
                <table>${generateHTMLTable(tables.rarityTables.find(({ rarity }) => rarity === 'Rotten').table, rarityColors, 'Rotten')}</table>
            </div>
            <div class="table-container">
                <h3>Moldy</h3>
                <table>${generateHTMLTable(tables.rarityTables.find(({ rarity }) => rarity === 'Moldy').table, rarityColors, 'Moldy')}</table>
                <h3>Super Rare</h3>
                <table>${generateHTMLTable(tables.rarityTables.find(({ rarity }) => rarity === 'Super Rare').table, rarityColors, 'Super Rare')}</table>
                <h3>Rarest 3 by Tier</h3>
                <table>${generateHTMLTable(tables.breakdownTable, rarityColors)}</table>
                <h3>Unhatched Egg Count by Rarity</h3>
                <table>${generateHTMLTable(tables.eggTable, rarityColors)}</table>
            </div>
        </div>
    </body>
    </html>
    `;

    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    await page.screenshot({ path: 'SankoPetBreakdown.png', fullPage: true });
    await browser.close();
}

function generateHTMLTable(table, rarityColors, defaultRarity = '') {
    const rows = table.map(row => {
        const rarity = defaultRarity || row[0].trim();
        const backgroundColor = rarityColors[rarity] || 'white';
        const cells = row.map(cell => `<td style="background-color: ${backgroundColor}">${cell}</td>`).join('');
        return `<tr>${cells}</tr>`;
    }).join('');
    return `<thead><tr>${table.options.head.map(cell => `<th>${cell}</th>`).join('')}</tr></thead><tbody>${rows}</tbody>`;
}

async function main() {
    const tables = await generateReport();
    if (generateImage) {
        await createImage(tables);
    }
}

main();
