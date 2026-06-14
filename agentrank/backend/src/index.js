require("dotenv").config();
const Fastify = require("fastify");
const cors = require("@fastify/cors");

const agentsRoutes = require("./routes/agents");
const ingestRoutes = require("./routes/ingest");
const ensPassportRoutes = require("./routes/ensPassport");
const resolveRoutes = require("./routes/resolve");
const analyticsRoutes = require("./routes/analytics");
const ratersRoutes = require("./routes/raters");
const ownersRoutes = require("./routes/owners");
const agentkitRoutes = require("./routes/agentkit");
const demoRoutes = require("./routes/demo");

const app = Fastify({ logger: true });

app.register(cors, { origin: "*" });

app.get("/health", async () => ({
  status: "ok",
  service: "agentrank-api",
  timestamp: new Date().toISOString(),
}));

app.register(agentsRoutes);
app.register(ingestRoutes);
app.register(ensPassportRoutes);
app.register(resolveRoutes);
app.register(analyticsRoutes);
app.register(ratersRoutes);
app.register(ownersRoutes);
app.register(agentkitRoutes);
app.register(demoRoutes);

const PORT = parseInt(process.env.PORT || "3001");

app.listen({ port: PORT, host: "0.0.0.0" }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  console.log(`AgentRank API running on http://localhost:${PORT}`);
});
