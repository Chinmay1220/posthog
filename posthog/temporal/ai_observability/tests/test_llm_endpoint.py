"""Tests for clustering labeling client construction (ai-gateway vs direct OpenAI)."""

import pytest
from unittest.mock import patch

from django.test import override_settings

from posthog.temporal.ai_observability.llm_endpoint import build_openai_chat_client

GATEWAY_URL = "https://gateway.example/v1"
GATEWAY_KEY = "phs_project_secret"


class TestBuildOpenAIChatClient:
    @override_settings(DEBUG=True, LLMA_GATEWAY_URL=GATEWAY_URL, LLMA_GATEWAY_API_KEY=GATEWAY_KEY)
    @patch.dict("os.environ", {"OPENAI_API_KEY": "sk-direct"}, clear=False)
    def test_gateway_mode_uses_gateway_url_and_phs_bearer(self):
        client = build_openai_chat_client("gpt-5.4", 600.0)
        assert client.openai_api_base == GATEWAY_URL
        assert client.openai_api_key.get_secret_value() == GATEWAY_KEY
        # Gateway mode injects a custom http client (trust_env=False) off the egress proxy.
        assert client.http_client is not None
        assert client.http_async_client is not None

    @override_settings(DEBUG=True, LLMA_GATEWAY_URL=None, LLMA_GATEWAY_API_KEY=None)
    @patch.dict("os.environ", {"OPENAI_API_KEY": "sk-direct"}, clear=False)
    def test_direct_mode_uses_default_endpoint_and_openai_key(self):
        client = build_openai_chat_client("gpt-5.4", 600.0)
        assert client.openai_api_base is None
        assert client.openai_api_key.get_secret_value() == "sk-direct"
        # Direct mode leaves the SDK default client so the OpenAI call can use egress.
        assert client.http_client is None

    @override_settings(DEBUG=True, LLMA_GATEWAY_URL=GATEWAY_URL, LLMA_GATEWAY_API_KEY=None)
    @patch.dict("os.environ", {"OPENAI_API_KEY": "sk-direct"}, clear=False)
    def test_url_without_key_raises_set_together(self):
        with pytest.raises(Exception, match="must be set together"):
            build_openai_chat_client("gpt-5.4", 600.0)

    @override_settings(DEBUG=True, LLMA_GATEWAY_URL=None, LLMA_GATEWAY_API_KEY=GATEWAY_KEY)
    @patch.dict("os.environ", {"OPENAI_API_KEY": "sk-direct"}, clear=False)
    def test_key_without_url_raises_set_together(self):
        with pytest.raises(Exception, match="must be set together"):
            build_openai_chat_client("gpt-5.4", 600.0)

    @override_settings(DEBUG=True, LLMA_GATEWAY_URL="https://gateway.example", LLMA_GATEWAY_API_KEY=GATEWAY_KEY)
    @patch.dict("os.environ", {"OPENAI_API_KEY": "sk-direct"}, clear=False)
    def test_gateway_url_missing_v1_path_raises(self):
        with pytest.raises(Exception, match="OpenAI base path"):
            build_openai_chat_client("gpt-5.4", 600.0)
