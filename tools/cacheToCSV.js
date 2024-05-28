import fs from 'fs';
import { createObjectCsvWriter } from 'csv-writer';

const jsonData = JSON.parse(fs.readFileSync('SankoPetCache.json', 'utf-8'));

const allAttributes = new Set();
Object.values(jsonData).forEach(metadata => {
  metadata.attributes.forEach(attr => {
    allAttributes.add(attr.trait_type);
  });
});

const headers = [
  { id: 'token_id', title: 'Token ID' },
  { id: 'name', title: 'Name' },
  { id: 'description', title: 'Description' },
  { id: 'image', title: 'Image' },
];

allAttributes.forEach(attr => {
  headers.push({ id: attr.toLowerCase().replace(/ /g, '_'), title: attr });
});

const csvWriter = createObjectCsvWriter({
  path: 'SankoPetData.csv',
  header: headers
});

const records = [];
Object.entries(jsonData).forEach(([tokenId, metadata]) => {
  const record = {
    token_id: tokenId,
    name: metadata.name,
    description: metadata.description,
    image: metadata.image
  };
  
  metadata.attributes.forEach(attr => {
    record[attr.trait_type.toLowerCase().replace(/ /g, '_')] = attr.value;
  });

  records.push(record);
});

csvWriter.writeRecords(records)
  .then(() => {
    console.log('...Done');
  });
