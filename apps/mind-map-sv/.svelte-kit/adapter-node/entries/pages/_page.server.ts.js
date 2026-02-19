import { b as private_env } from "../../chunks/shared-server.js";
const load = async ({ params }) => {
  const appName = private_env.APP_NAME || "No APP_NAME";
  return { appName };
};
export {
  load
};
