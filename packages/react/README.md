# Sinkr

React SDK for Sinkr.

Jsage:
```tsx
import { SinkrProvider, useSinkr } from "@sinkr/react";


// Parent component of some kind, e.g. nextjs root layout
function MyParentComponent() {

    return <SinkrProvider url={"wss://my-sinkr-url.com/my-app-id"}>
        {children}
    </SinkrProvider>
}

// Child component
function MyChildComponent() {
    const eventListener = useSinkr();

    useEffect(() => {
        const unsub = eventListener.on("my-event", (data) => {
            console.log(data);
        });
        return () => {
            unsub();
        }
    }, [eventListener]);
}

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
