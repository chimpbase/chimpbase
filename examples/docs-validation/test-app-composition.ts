import type { ChimpbaseAppDefinitionInput } from "@chimpbase/bun";
import { action, subscription, worker, cron, v, Action, Subscription, Worker, Cron, registrationsFrom } from "@chimpbase/runtime";
const createCustomer = action({ name: "createCustomer", args: v.object({ name: v.string() }), async handler(_ctx, input) { return input; } });
const listCustomers = action({ name: "listCustomers", args: v.object({}), async handler() { return []; } });
const syncHandler = async (_ctx: any, _event: any) => {};
const syncCustomer = async (_ctx: any, _payload: any) => {};
const generateDailyReport = async (_ctx: any) => {};
const appDef = { project: { name: "my-app" }, registrations: [createCustomer, listCustomers, subscription("customer.created", syncHandler, { idempotent: true, name: "enqueueSync" }), worker("customer.sync", syncCustomer), cron("reports.daily", "0 9 * * *", generateDailyReport)] } satisfies ChimpbaseAppDefinitionInput;
class TodoModule { @Action("createTodoDeco") async createTodo(_ctx: any, input: any) { return input; } @Subscription("todo.created") async auditTodoCreated(_ctx: any, _event: any) {} @Worker("todo.notify") async notifyTodoCompleted(_ctx: any, _payload: any) {} @Cron("backlog.snapshot", "*/15 * * * *") async captureSnapshot(_ctx: any, _invocation: any) {} }
const decoApp = { project: { name: "my-app" }, registrations: registrationsFrom(TodoModule) } satisfies ChimpbaseAppDefinitionInput;
console.log("app-composition: OK (regular:", appDef != null, "decorators:", decoApp != null, ")");
