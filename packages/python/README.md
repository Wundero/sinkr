Python SDK for `Sinkr`.

Usage:

```py

from sinkr import SinkrSource


my_source = SinkrSource()
my_source.send_to_channel("my-channel", "my-event", {
    "my-data": 123
})
```
