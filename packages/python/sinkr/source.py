from collections.abc import Mapping
from typing import Optional
from urllib.parse import urlparse
import os
import requests
from requests.compat import basestring


def stream_with_prelude(prelude, iterable):
    yield prelude
    for item in iterable:
        yield item


def data_is_stream(data):
    return hasattr(data, "__iter__") and not isinstance(
        data, (basestring, list, tuple, Mapping)
    )


class SinkrSource:
    def __init__(
        self,
        url: Optional[str] = None,
        app_key: Optional[str] = None,
        app_id: Optional[str] = None,
    ):
        url = url or os.getenv("SINKR_URL")
        app_key = app_key or os.getenv("SINKR_APP_KEY")
        app_id = app_id or os.getenv("SINKR_APP_ID")
        if not url:
            raise ValueError("Missing required parameters: url")
        if not app_key:
            raise ValueError("Missing required parameters: app_key")
        parsed_url = urlparse(url)
        if parsed_url.scheme != "http" and parsed_url.scheme != "https":
            scheme = "%s://" % parsed_url.scheme
            url = url.replace(scheme, "https://", 1)
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
        if data_is_stream(body):
            return self.session.post(
                self.url,
                data=body,
                headers={"X-Sinkr-Stream": "true"},
            )
        else:
            return self.session.post(self.url, json=body)

    def authenticate_user(self, peer_id: str, user_id: str, user_info: dict):
        body = {
            "route": "authenticate",
            "peerId": peer_id,
            "id": user_id,
            "userInfo": user_info,
        }
        return self.__fetch(body)

    def subscribe_to_channel(self, user_id: str, channel: str):
        body = {
            "route": "subscribe",
            "subscriberId": user_id,
            "channel": channel,
        }
        return self.__fetch(body)

    def unsubscribe_from_channel(self, user_id: str, channel: str):
        body = {
            "route": "unsubscribe",
            "subscriberId": user_id,
            "channel": channel,
        }
        return self.__fetch(body)

    def send_message_to_channel(self, channel: str, event: str, message):
        body = {
            "route": "channel",
            "event": event,
            "channel": channel,
        }
        if data_is_stream(message):
            return self.__fetch(stream_with_prelude(body, message))
        body["message"] = message
        return self.__fetch(body)

    def send_message_to_user(self, user_id: str, event: str, message):
        body = {
            "route": "direct",
            "event": event,
            "recipientId": user_id,
        }
        if data_is_stream(message):
            return self.__fetch(stream_with_prelude(body, message))
        body["message"] = message
        return self.__fetch(body)

    def broadcast_message(self, event: str, message):
        body = {
            "route": "broadcast",
            "event": event,
        }
        if data_is_stream(message):
            return self.__fetch(stream_with_prelude(body, message))
        body["message"] = message
        return self.__fetch(body)
