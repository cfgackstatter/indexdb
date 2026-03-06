from importlib import import_module
from backend.config import PROVIDERS

REGISTRY: dict = {
    name: import_module(f"backend.providers.{name.replace('-', '_')}").provider
    for name in PROVIDERS
}

def get_provider(name: str):
    if name not in REGISTRY:
        raise ValueError(f"Unknown provider: '{name}'. Available: {list(REGISTRY.keys())}")
    return REGISTRY[name]
