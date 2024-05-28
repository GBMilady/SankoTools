# SankoTools
Assorted random tools and scripts for use on **Sanko Mainnet**

# Sanko Mainnet Tools
## tools/takeSnapshot.js

Generates a snapshot of token holders for a given ERC20, ERC721, or ERC1155 contract. Saves the snapshot as JSON or CSV format.

### Arguments

*   `--contract, -c` (required): Contract address of an ERC20, ERC721, or ERC1155 token
*   `--block, -b` Contract creation block (if known), if a snapshot has already been taken it will use the previously saved block, if this is a first run on a contract, not specifying the creation block is not recommended as the entire history of Sanko will get iterated over and you'll be waiting a long time. Just get it from the [block explorer](https://explorer.sanko.xyz).
*   `--csv` Save snapshot in CSV format
*   `--refresh` Refresh holder data from the creation block if snapshot data already exists

### Usage

```node tools/takeSnapshot.js --contract <contractAddress> [--block <creationBlock>] [--csv] [--refresh]```

## tools/airdropTokens.js

Airdrop ERC20, ERC721, or ERC1155 tokens to multiple wallet addresses from a given CSV file. Utilizes a self-deployed contract of Gaslite Drop to facilitate batch transactions until support is added to the native tool.

CSV formatting must be in the form of:

```[WALLET ADDRESS], [TOKEN AMOUNT (ERC20) OR TOKENID (ERC721, ERC1155)]```

### Arguments

*   `--token, -t` (required): The contract address of the ERC20, ERC721, or ERC1155 tokens you want to airdrop
*   `--to, -f` (required): CSV file with wallet addresses and token amounts (or token IDs for ERC721 and ERC1155)
*   `--erc20` Airdrop ERC20 tokens. Conflicts with --erc721 and --erc1155
*   `--erc721` Airdrop ERC721 tokens. Conflicts with --erc20 and --erc1155
*   `--erc1155` Airdrop ERC1155 tokens. Conflicts with --erc20 and --erc721
*   `--batch, -b` Number of transfers to batch in a single tx, defaults to 500, min: 1 max: 2000

### Usage

```node tools/airdropTokens.js --token <contractAddress> --to <csvFile> [--erc20 | --erc721 | --erc1155] [--batch <1-2000>]```

# Sanko Pets Tools
## tools/tallySankoPets.js

Retrieves metadata for Sanko Pets from Sanko Mainnet and generates reports detailing bun population data. Also caches the on-chain data for repeat use.

If the `--image` flag is provided, an image named `SankoPetBreakdown.png` will be created.

### Arguments

*   `--debug`: Debug output
*   `--refreshall`: Forces a refresh the metadata for all tokens
*   `--refresheggs`: Forces a refresh the metadata for Egg tokens
*   `--image`: Generates an image of the report
*   `--no-premint`: Skips the first 300 token IDs and starts processing from token ID 301

## tools/cacheToCSV.js

Converts the cached metadata from `tallySankoPets.js` to CSV for import into tools like Dune.

## tools/getSankoPetMetadata.js

Queries the Sanko Pets contract for metadata of a specific token ID.

### Usage

```node tools/getSankoPetMetadata.js <tokenId> [--debug]```

### Arguments

*   `<tokenId>` (required): The ID of the token to query
*   `--debug` (optional): Debug output