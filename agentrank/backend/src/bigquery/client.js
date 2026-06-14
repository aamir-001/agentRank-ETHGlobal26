require("dotenv").config();
const { BigQuery } = require("@google-cloud/bigquery");

const bigquery = new BigQuery({
  projectId: process.env.GOOGLE_CLOUD_PROJECT,
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});

async function runQuery(query, params = {}, types = undefined) {
  const opts = {
    query,
    params,
    location: "US",
    useLegacySql: false,
  };
  // Explicit param types are required for array params that may be empty and
  // help BigQuery infer UNNEST element types reliably.
  if (types) opts.types = types;
  const [rows] = await bigquery.query(opts);
  return rows;
}

module.exports = { runQuery };
