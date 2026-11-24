import type { NextRequest } from "next/server";
import { getProject as getProjectContract, updateProject as updateProjectContract } from "@workspace/api-contract";
import { nameMap, toApi, labelFor } from "../functions";
import { businessOf } from "@/lib/api/functions/http/guards";
import * as projects from "@/lib/api/functions/services/project";
import { handle } from "@/lib/api/functions/http/handler";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, getProjectContract, { feature: "projects", params }, async ({ req, params }) => {
    const business = businessOf(req);
    const row = await projects.getProject(business.id, params.id);
    const [names, money] = await Promise.all([
      nameMap(business.id),
      projects.computeProjectMoney(business.id, [row]),
    ]);
    return { project: toApi(row, names), money: money.get(row.id)!, label: labelFor(business.businessType) };
  });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, updateProjectContract, { feature: "projects", write: true, params }, async ({ req, params, body }) => {
    const business = businessOf(req);
    const updated = await projects.updateProject(business.id, params.id, body);
    return toApi(updated, await nameMap(business.id));
  });
}
