Python SDK for `Sinkr`.

Usage:

```py

from sinkr import SinkrSource


async with SinkrSource() as my_source:
    await my_source.send_to_channel("my-channel", "my-event", {
        "my-data": 123
    })
```
