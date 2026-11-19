import { handle } from "../server/plant-service.mjs";
export default function handler(req, res) {
  return handle(req, res, "/api/plant");
}
