import type { NextRequest } from "next/server";
import { listProjects as listProjectsContract, createProject as createProjectContract } from "@workspace/api-contract";
import { nameMap, toApi, labelFor } from "./functions";
import { businessOf } from "@/lib/api/functions/http/guards";
import * as projects from "@/lib/api/functions/services/project";
import { handle } from "@/lib/api/functions/http/handler";

export async function GET(request: NextRequest) {
  return handle(request, listProjectsContract, { feature: "projects" }, async ({ req, query }) => {
    const business = businessOf(req);
    const [rows, names] = await Promise.all([
      projects.listProjects(business.id, query.status),
      nameMap(business.id),
    ]);
    const money = await projects.computeProjectMoney(business.id, rows);
    return {
      items: rows.map((row) => ({ ...toApi(row, names), money: money.get(row.id)! })),
      label: labelFor(business.businessType),
    };
  });
}

export async function POST(request: NextRequest) {
  return handle(request, createProjectContract, { feature: "projects", write: true }, async ({ req, body }) => {
    const business = businessOf(req);
    const created = await projects.createProject(business.id, body);
    return toApi(created, await nameMap(business.id));
  });
}
