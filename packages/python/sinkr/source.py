from collections.abc import Mapping
from typing import Optional
from urllib.parse import urlparse
import os
import requests
import json
from requests.compat import basestring


def stream_with_prelude(prelude, iterable):
    """
    Attach a prelude object to an iterable stream.

    :param prelude: The prelude object to attach.
    :param iterable: The iterable stream to attach the prelude to.

    :return: A new stream with the prelude attached.
    """
    yield json.dumps(prelude)
    for item in iterable:
        yield json.dumps(item)


def data_is_stream(data):
    """
    Determine if the data type is a stream.

    :param data: The data to check.

    :return: True if the data is a stream, False otherwise.
    """
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
        """
        Create a new source to send messages to Sinkr.

        Parameters fall back to environment variables if not provided.

        :param url: The Sinkr URL to connect to.
        :param app_key: The Sinkr app key to authenticate with.
        :param app_id: The Sinkr app ID to connect to.

        :raises ValueError: If the URL or app key is missing.

        :return: A new Sinkr source.
        """
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
            res = self.session.post(
                self.url,
                data=body,
                headers={"X-Sinkr-Stream": "true"},
            )
            return res.status_code
        else:
            res = self.session.post(self.url, json=body)
            return res.status_code

    def authenticate_user(self, peer_id: str, user_id: str, user_info: dict):
        """
        Authenticate a user with Sinkr.

        :param peer_id: The peer ID of the user's connection.
        :param user_id: The ID of the user.
        :param user_info: The user's information.

        :return: The HTTP status code from Sinkr.
        """
        body = {
            "route": "authenticate",
            "peerId": peer_id,
            "id": user_id,
            "userInfo": user_info,
        }
        return self.__fetch(body)

    def subscribe_to_channel(self, user_id: str, channel: str):
        """
        Subscribe a user to a channel. If the channel is a private or presence channel, the user must be authenticated.

        :param user_id: The ID of the user to subscribe. This can be a connection's peer ID or, if authenticated, the user's ID.
        :param channel: The channel to subscribe to.

        :return: The HTTP status code from Sinkr.
        """
        body = {
            "route": "subscribe",
            "subscriberId": user_id,
            "channel": channel,
        }
        return self.__fetch(body)

    def unsubscribe_from_channel(self, user_id: str, channel: str):
        """
        Unsubscribe a user from a channel.

        :param user_id: The ID of the user to unsubscribe. This can be a connection's peer ID or, if authenticated, the user's ID.
        :param channel: The channel to unsubscribe from.

        :return: The HTTP status code from Sinkr.
        """
        body = {
            "route": "unsubscribe",
            "subscriberId": user_id,
            "channel": channel,
        }
        return self.__fetch(body)

    def send_message_to_channel(self, channel: str, event: str, message):
        """
        Send a message to a channel.

        :param channel: The channel to send the message to.
        :param event: The event to send.
        :param message: The message to send. If this is a stream, messages will be sent for each chunk of the stream.

        :return: The HTTP status code from Sinkr.
        """
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
        """
        Send a message to a user.

        :param user_id: The ID of the user to send the message to.
        :param event: The event to send.
        :param message: The message to send. If this is a stream, messages will be sent for each chunk of the stream.

        :return: The HTTP status code from Sinkr.
        """
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
        """
        Broadcast a message to all users.

        :param event: The event to send.
        :param message: The message to send. If this is a stream, messages will be sent for each chunk of the stream.

        :return: The HTTP status code from Sinkr.
        """
        body = {
            "route": "broadcast",
            "event": event,
        }
        if data_is_stream(message):
            return self.__fetch(stream_with_prelude(body, message))
        body["message"] = message
        return self.__fetch(body)
