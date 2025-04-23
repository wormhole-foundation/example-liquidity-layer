use bytemuck::{Pod, Zeroable};

#[derive(Debug, Copy, Clone, Pod, Zeroable)]
#[repr(C)]
pub struct PlaceInitialOfferCctpShimData {
    pub offer_price: u64,
}

impl PlaceInitialOfferCctpShimData {
    pub fn from_bytes(data: &[u8]) -> Option<&Self> {
        bytemuck::try_from_bytes::<Self>(data).ok()
    }
}
