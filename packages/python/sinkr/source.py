from collections.abc import Mapping
from typing import Optional
from urllib.parse import urlparse
from aiohttp import ClientSession
import os
import json
from requests.compat import basestring
import uuid
from websockets.asyncio.client import connect


def augment_stream(prelude: dict, iterable):
    """
    Attach a prelude object to an iterable stream.

    :param prelude: The prelude object to attach.
    :param iterable: The iterable stream to attach the prelude to.

    :return: A new stream with the prelude attached.
    """
    for item in iterable:
        obj = prelude.copy()
        obj["message"] = item
        yield obj


def data_is_stream(data):
    """
    Determine if the data type is a stream.

    :param data: The data to check.

    :return: True if the data is a stream, False otherwise.
    """
    if isinstance(data, (basestring, list, tuple, Mapping, dict)):
        return False
    return hasattr(data, "__iter__") or hasattr(data, "__aiter__")


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
        self.app_key = app_key
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
        self.ws_url = (
            self.url.replace("https://", "wss://", 1).replace("http://", "ws://", 1)
            + "?appKey="
            + app_key
        )
        self.ws_session = None
        self.session = ClientSession()
        self.session.headers.update({"Authorization": f"Bearer {self.app_key}"})
        self.ready = False

    async def __aenter__(self):
        await self.session.__aenter__()
        self.ws_session = await connect(self.ws_url)
        await self.ws_session.__aenter__()
        self.ready = True
        return self

    async def __aexit__(self, exc_type, exc_value, traceback):
        await self.session.__aexit__(exc_type, exc_value, traceback)
        await self.ws_session.__aexit__(exc_type, exc_value, traceback)
        self.ready = False

    def __ensure_ready(self):
        if not self.ready:
            raise ValueError(
                "SinkrSource is not ready. Use `async with` to initialize."
            )

    async def __fetch(self, body):
        self.__ensure_ready()
        if data_is_stream(body):
            resps = []
            if hasattr(body, "__aiter__"):
                async for part in body:
                    part_id = uuid.uuid4().hex
                    obj = {
                        "id": part_id,
                        "data": part,
                    }
                    await self.ws_session.send(json.dumps(obj))
                    resp = await self.ws_session.recv(True)
                    resp_obj = json.loads(resp)
                    resp_id = resp_obj.get("id")
                    if resp_id == part_id:
                        resps.append(resp_obj.get("status", 500))
                    else:
                        pass
            else:
                for part in body:
                    part_id = uuid.uuid4().hex
                    obj = {
                        "id": part_id,
                        "data": part,
                    }
                    await self.ws_session.send(json.dumps(obj))
                    resp = await self.ws_session.recv(True)
                    resp_obj = json.loads(resp)
                    resp_id = resp_obj.get("id")
                    if resp_id == part_id:
                        resps.append(resp_obj.get("status", 500))
                    else:
                        pass
            return resps
        else:
            async with self.session.post(
                self.url, json={"data": body, "id": uuid.uuid4().hex}
            ) as res:
                return res.status

    async def authenticate_user(self, peer_id: str, user_id: str, user_info: dict):
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
        return await self.__fetch(body)

    async def subscribe_to_channel(self, user_id: str, channel: str):
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
        return await self.__fetch(body)

    async def unsubscribe_from_channel(self, user_id: str, channel: str):
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
        return await self.__fetch(body)

    async def send_message_to_channel(self, channel: str, event: str, message):
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
            return await self.__fetch(augment_stream(body, message))
        body["message"] = message
        return await self.__fetch(body)

    async def send_message_to_user(self, user_id: str, event: str, message):
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
            return await self.__fetch(augment_stream(body, message))
        body["message"] = message
        return await self.__fetch(body)

    async def broadcast_message(self, event: str, message):
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
            return await self.__fetch(augment_stream(body, message))
        body["message"] = message
        return await self.__fetch(body)
