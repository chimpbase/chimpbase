# Plugins

Plugins are composable groups of registrations (actions, routes, subscriptions, workers, crons, workflows). They provide a way to package and distribute reusable functionality.

## Creating a Plugin

```ts
import { action, plugin, route, subscription, worker } from "@chimpbase/runtime";

export function myPlugin(options: MyPluginOptions) {
  const entries = [];

  entries.push(
    action("myPlugin.doSomething", async (ctx) => {
      // ...
    }),
  );

  entries.push(
    route("myPlugin.api", async (request, env) => {
      // return Response or null
    }),
  );

  return plugin({ name: "my-plugin" }, ...entries);
}
```

## Using Plugins

Register plugins in your app's `registrations` array:

```ts
import { myPlugin } from "./my-plugin";

export default {
  registrations: [
    myPlugin({ /* options */ }),
    // ... other registrations
  ],
};
```

## Plugin Dependencies

Plugins can declare dependencies on other plugins to ensure ordering:

```ts
plugin(
  {
    name: "webhooks",
    dependsOn: [{ name: "auth" }],
  },
  ...entries,
);
```

## Official Plugins

| Plugin | Package | Description |
|--------|---------|-------------|
| [Auth](/auth) | `@chimpbase/auth` | API key authentication, user management, scopes, rate limiting |
| [Webhooks](/webhooks) | `@chimpbase/webhooks` | Outbound + inbound webhooks with HMAC and dedup |
| [REST Collections](/rest-collections) | `@chimpbase/rest-collections` | Expose collections as REST APIs |

## Plugin Pattern

The standard plugin pattern used by all official plugins:

1. Export a function that accepts options and returns `ChimpbasePluginRegistration`
2. Build an array of registrations (actions, routes, subscriptions, workers)
3. Wrap with `plugin()` to group and name them
4. Use internal collection/KV namespaces prefixed with `__chimpbase.{pluginName}.*`
5. Use internal action names prefixed with `__chimpbase.{pluginName}.*`

```ts
export function chimpbaseExample(options: ExampleOptions): ChimpbasePluginRegistration {
  const entries: ChimpbaseRegistrationSource[] = [];

  // Add actions, routes, workers, etc.
  entries.push(action("__chimpbase.example.doStuff", handler));

  return plugin({ name: "chimpbase-example" }, ...entries);
}
```
