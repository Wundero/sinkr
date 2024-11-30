from collections.abc import Mapping
from typing import Optional
from urllib.parse import urlparse

import requests
from requests.compat import basestring


class SinkrSource:
    def __init__(self, url: str, app_key: str, app_id: Optional[str] = None):
        parsed_url = urlparse(url)
        if len(parsed_url.path) <= 1 and app_id:
            self.url = (url + "/" + app_id).replace("//", "/")
        elif len(parsed_url.path) <= 1 and not app_id:
            raise ValueError("Missing app_id!")
        else:
            self.url = url
        self.app_key = app_key
        self.session = requests.Session()
        self.session.headers.update({"Authorization": f"Bearer {app_key}"})

    def __fetch(self, body):
        is_stream = hasattr(body, "__iter__") and not isinstance(
            body, (basestring, list, tuple, Mapping)
        )
        if is_stream:
            return self.session.post(
                self.url,
                data=body,
                headers={"X-Sinkr-Stream": "true"},
            )
        else:
            return self.session.post(self.url, json=body)
