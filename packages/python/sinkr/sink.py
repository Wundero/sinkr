import os
import json
from typing import Optional
from urllib.parse import urlparse
from websockets.asyncio.client import connect
from contextlib import AbstractAsyncContextManager
import nanoid
import asyncio


class SinkrSink(AbstractAsyncContextManager):
    def __init__(self, url: Optional[str] = None, app_id: Optional[str] = None):
        """
        Create a new sink to receive messages from Sinkr.

        Parameters fall back to environment variables if not provided.

        Can be used as an async context manager to handle the connection.

        :param url: The Sinkr URL to connect to.
        :param app_id: The Sinkr app ID to connect to.
        """
        url = url or os.getenv("SINKR_URL")
        app_id = app_id or os.getenv("SINKR_APP_ID")
        parsed_url = urlparse(url)
        if parsed_url.scheme != "ws" and parsed_url.scheme != "wss":
            scheme = "%s://" % parsed_url.scheme
            url = url.replace(scheme, "wss://", 1)
        if len(parsed_url.path) <= 1 and app_id:
            self.url = (url + "/" + app_id).replace("//", "/")
        elif len(parsed_url.path) <= 1 and not app_id:
            raise ValueError("Missing app_id!")
        else:
            self.url = url
        self.ws = None
        self.callbacks: dict[str, dict[str, callable]] = {}
        self.global_callbacks: dict[str, callable] = {}
        self.messages = []

    def on(self, event: Optional[str], callback: callable):
        """
        Subscribe to an event.

        :param event: The event to subscribe to. Use None to subscribe to all events.
        :param callback: The callback to call when the event is received.

        :return: A function to unsubscribe from the event.
        """
        callback_id = nanoid.generate()
        if not event:
            self.global_callbacks[callback_id] = callback
            return lambda: self.global_callbacks.pop(callback_id, callback)
        if event not in self.callbacks:
            self.callbacks[event] = {}
        self.callbacks[event][callback_id] = callback
        return lambda: self.callbacks[event].pop(callback_id, callback)

    def once(self, event: Optional[str], callback: callable):
        """
        Subscribe to an event once.

        :param event: The event to subscribe to. Use None to subscribe to any event.
        :param callback: The callback to call when the event is received.

        :return: A function to unsubscribe from the event. Does nothing if the event has already been received.
        """

        if asyncio.iscoroutinefunction(callback):

            async def once_callback(data):
                await callback(data)
                off()
        else:

            def once_callback(data):
                callback(data)
                off()

        off = self.on(event, once_callback)
        return off

    def clear_listeners(self, event: Optional[str] = None):
        """
        Clear all listeners for an event. If no event is provided, clear all listeners.

        :param event: The event to clear listeners for. Use None to clear all listeners.
        """
        if not event:
            self.callbacks = {}
            self.global_callbacks = {}
        else:
            self.callbacks[event] = {}

    async def __trigger_callbacks(self, message: str):
        data = json.loads(message)
        event = data["data"]["event"]
        relevant_callbacks = self.callbacks.get(event, {})
        for callback in relevant_callbacks.values():
            if asyncio.iscoroutinefunction(callback):
                await callback(data["data"])
            else:
                callback(data["data"])
        for callback in self.global_callbacks.values():
            if asyncio.iscoroutinefunction(callback):
                await callback(data["data"])
            else:
                callback(data["data"])

    async def __iter__messages(self):
        while True:
            if not self.ws:
                return
            message = await self.ws.recv(True)
            self.messages.append(message)
            await self.__trigger_callbacks(message)

    async def __aenter__(self):
        self.ws = await connect(self.url)
        self.ws.__aenter__()
        self.__iter__messages()
        return self

    async def __aexit__(self, exc_type, exc, tb):
        await self.ws.__aexit__(exc_type, exc, tb)
        self.ws = None
