# Sinkr

TypeScript SDK for Sinkr.

Server-side usage:
```ts
import { source } from "@sinkr/core";

const mySource = source();
await mySource.sendToChannel("my-channel", "my-event", {
    myData: 123;
});
```

Client-side usage:
```ts
import { sink } from "@sinkr/core";

const mySink = sink();
mySink.on("my-event", (eventData) => {
    console.log(eventData);
});
```

Module augmentation is recommended to make types stronger.

```ts
declare module "@sinkr/core" {
    interface EventMap {
        "my-event": {
            myData: number;
        }
    }
}
```
