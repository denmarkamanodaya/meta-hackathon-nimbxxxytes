//! Driven adapters: the only code that touches HTTP, the Keychain, the file system and the Trash.

pub mod api_client;
pub mod chunk_cache;
pub mod json_file;
pub mod keychain;
pub mod nfs_drive;
pub mod range_http;
pub mod system;
