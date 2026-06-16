import { NextResponse } from "next/server";
import { paperStore } from "@/lib/strategy-v121/execution/paperStore";

/**
 * GET /api/v121/positions — open paper positions
 */
export async function GET() {
  const executions = paperStore.findAll();
  const openPositions = executions.filter(e =>
    ["OPEN", "MONITORING"].includes(e.state),
  );

  return NextResponse.json({
    positions: openPositions.map(e => ({
      id: e.id,
      symbol: e.path.symbol,
      spotExchange: e.path.spotExchange,
      perpExchange: e.path.perpExchange,
      state: e.state,
      spotNotional: e.spotNotional,
      perpNotional: e.perpNotional,
      spotAvgPrice: e.spotAvgPrice,
      perpAvgPrice: e.perpAvgPrice,
      spotFilledQty: e.spotFilledQty,
      perpFilledQty: e.perpFilledQty,
      positionDeviation: e.positionDeviation,
      actualBasis: e.actualBasis,
      createdAtUtc: e.createdAtUtc,
      updatedAtUtc: e.updatedAtUtc,
      logs: e.logs.slice(-3),
    })),
    total: openPositions.length,
    dataSource: "paper-in-memory",
  });
}
