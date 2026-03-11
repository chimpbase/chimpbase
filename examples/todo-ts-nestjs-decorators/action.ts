import { createTodoApplication } from "./app.ts";

const actionName = Bun.argv[2];
const rawArgs = Bun.argv[3];

if (!actionName) {
  throw new Error("missing action name");
}

const args = rawArgs ? JSON.parse(rawArgs) as unknown[] : [];
const { chimpbase, close } = await createTodoApplication();
const outcome = await chimpbase.executeAction(actionName, args);

try {
  console.log(`executed action ${actionName}`);
  console.log(JSON.stringify(outcome.result, null, 2));
} finally {
  await close();
}
