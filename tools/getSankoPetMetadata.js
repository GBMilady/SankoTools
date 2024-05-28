const contractAddress = "0xE3351CE33689dc444B1a45B8f8F447A181D57227";
const jsonRpcUrl = "https://mainnet.sanko.xyz";

const tokenId = process.argv[2];
const debug = process.argv.includes('--debug');

if (!tokenId) {
    console.error("Please provide a token ID");
    process.exit(1);
}

async function queryTokenURI() {
    const data = {
        jsonrpc: "2.0",
        method: "eth_call",
        params: [
            {
                to: contractAddress,
                data: `0xc87b56dd${parseInt(tokenId).toString(16).padStart(64, '0')}` // 0xc87b56dd is the function selector for tokenURI(uint256)
            },
            "latest"
        ],
        id: 1
    };

    try {
        const response = await fetch(jsonRpcUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(data)
        });

        const result = await response.json();
        if (result.error) {
            console.error("Error:", result.error);
        } else {
            if (debug) {
                // Log raw hex result if debug flag is provided
                console.log("Raw hex result:", result.result);
            }

            // The result will be in hex, so we need to convert it back to a string
            const hexUri = result.result;
            const tokenUri = hexToAscii(hexUri).trim();
            if (debug) {
                console.log("Converted ASCII URI:", tokenUri);
            }

            // Check for the presence of the base64 JSON prefix
            if (tokenUri.includes('data:application/json;base64,')) {
                const base64Json = tokenUri.split(',')[1];
                if (debug) {
                    console.log("Base64 JSON part:", base64Json);
                }

                try {
                    const jsonString = Buffer.from(base64Json, 'base64').toString('utf-8');
                    if (debug) {
                        console.log("Decoded JSON string:", jsonString);
                    }

                    const jsonObject = JSON.parse(jsonString);
                    console.log(`Sanko Pet ${tokenId} metadata:
                    `);
                    console.log(jsonObject)
                } catch (e) {
                    console.error("Base64 decoding or JSON parsing error:", e);
                }
            } else {
                console.error("Token URI is not in the expected base64 encoded JSON format.");
            }
        }
    } catch (error) {
        console.error("Fetch Error:", error);
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

queryTokenURI();
