mod deposit;
pub use deposit::*;

use wormhole_raw_vaas::{cctp::Deposit, Payload};

#[derive(Debug, Copy, Clone, PartialEq, Eq, Hash)]
pub struct LiquidityLayerPayload<'a> {
    span: &'a [u8],

    message: LiquidityLayerMessage<'a>,
}

impl<'a> AsRef<[u8]> for LiquidityLayerPayload<'a> {
    fn as_ref(&self) -> &[u8] {
        self.span
    }
}

impl<'a> TryFrom<Payload<'a>> for LiquidityLayerPayload<'a> {
    type Error = &'static str;

    fn try_from(payload: Payload<'a>) -> Result<Self, &'static str> {
        Self::parse(payload.into())
    }
}

impl<'a> LiquidityLayerPayload<'a> {
    pub fn span(&self) -> &[u8] {
        self.span
    }

    pub fn message(&self) -> LiquidityLayerMessage<'a> {
        self.message
    }

    pub fn parse(span: &'a [u8]) -> Result<Self, &'static str> {
        if span.is_empty() {
            return Err("LiquidityLayerPayload span too short. Need at least 1 byte");
        }

        let message = LiquidityLayerMessage::parse(span)?;

        Ok(Self { span, message })
    }
}

/// The non-type-flag contents
#[derive(Debug, Copy, Clone, PartialEq, Eq, Hash)]
pub enum LiquidityLayerMessage<'a> {
    Deposit(Deposit<'a>),
    FastMarketOrder(FastMarketOrder<'a>),
    FastFill(FastFill<'a>),
}

impl<'a> TryFrom<Payload<'a>> for LiquidityLayerMessage<'a> {
    type Error = &'static str;

    fn try_from(payload: Payload<'a>) -> Result<Self, &'static str> {
        Self::parse(payload.into())
    }
}

impl<'a> AsRef<[u8]> for LiquidityLayerMessage<'a> {
    fn as_ref(&self) -> &[u8] {
        match self {
            Self::Deposit(inner) => inner.as_ref(),
            Self::FastMarketOrder(inner) => inner.as_ref(),
            Self::FastFill(inner) => inner.as_ref(),
        }
    }
}

impl<'a> LiquidityLayerMessage<'a> {
    pub fn span(&self) -> &[u8] {
        self.as_ref()
    }

    pub fn deposit(&self) -> Option<&Deposit> {
        match self {
            Self::Deposit(inner) => Some(inner),
            _ => None,
        }
    }

    pub fn to_deposit_unchecked(self) -> Deposit<'a> {
        match self {
            Self::Deposit(inner) => inner,
            // The purpose of using this method is knowing that the enum variant is Deposit.
            #[allow(clippy::panic)]
            _ => panic!("LiquidityLayerMessage is not Deposit"),
        }
    }

    pub fn fast_fill(&self) -> Option<&FastFill> {
        match self {
            Self::FastFill(inner) => Some(inner),
            _ => None,
        }
    }

    pub fn to_fast_fill_unchecked(self) -> FastFill<'a> {
        match self {
            Self::FastFill(inner) => inner,
            // The purpose of using this method is knowing that the enum variant is FastFill.
            #[allow(clippy::panic)]
            _ => panic!("LiquidityLayerMessage is not FastFill"),
        }
    }

    pub fn fast_market_order(&self) -> Option<&FastMarketOrder> {
        match self {
            Self::FastMarketOrder(inner) => Some(inner),
            _ => None,
        }
    }

    pub fn to_fast_market_order_unchecked(self) -> FastMarketOrder<'a> {
        match self {
            Self::FastMarketOrder(inner) => inner,
            // The purpose of using this method is knowing that the enum variant is FastMarketOrder.
            #[allow(clippy::panic)]
            _ => panic!("LiquidityLayerMessage is not FastMarketOrder"),
        }
    }

    pub fn parse(span: &'a [u8]) -> Result<Self, &'static str> {
        if span.is_empty() {
            return Err("LiquidityLayerMessage span too short. Need at least 1 byte");
        }

        match span[0] {
            1 => Ok(Self::Deposit(Deposit::parse(&span[1..])?)),
            11 => Ok(Self::FastMarketOrder(FastMarketOrder::parse(&span[1..])?)),
            12 => Ok(Self::FastFill(FastFill::parse(&span[1..])?)),
            _ => Err("Unknown LiquidityLayerMessage type"),
        }
    }
}

#[derive(Debug, Copy, Clone, PartialEq, Eq, Hash)]
pub struct FastFill<'a>(&'a [u8]);

impl<'a> AsRef<[u8]> for FastFill<'a> {
    fn as_ref(&self) -> &[u8] {
        self.0
    }
}

impl<'a> FastFill<'a> {
    pub fn amount(&self) -> u64 {
        u64::from_be_bytes(self.0[..8].try_into().unwrap())
    }

    pub fn fill(&'a self) -> Fill<'a> {
        Fill::parse(&self.0[8..]).unwrap()
    }

    pub fn parse(span: &'a [u8]) -> Result<Self, &'static str> {
        if span.len() < 78 {
            return Err("FastFill span too short. Need at least 78 bytes");
        }

        let fast_fill = Self(span);

        // Check payload length vs actual payload.
        let fill = fast_fill.fill();
        if fill.redeemer_message().len() != usize::try_from(fill.redeemer_message_len()).unwrap() {
            return Err("Fill payload length mismatch");
        }

        Ok(fast_fill)
    }
}

#[derive(Debug, Copy, Clone, PartialEq, Eq, Hash)]
pub struct FastMarketOrder<'a>(&'a [u8]);

impl<'a> AsRef<[u8]> for FastMarketOrder<'a> {
    fn as_ref(&self) -> &[u8] {
        self.0
    }
}

impl<'a> FastMarketOrder<'a> {
    pub fn amount_in(&self) -> u64 {
        u64::from_be_bytes(self.0[..8].try_into().unwrap())
    }

    pub fn min_amount_out(&self) -> u64 {
        u64::from_be_bytes(self.0[8..16].try_into().unwrap())
    }

    pub fn target_chain(&self) -> u16 {
        u16::from_be_bytes(self.0[16..18].try_into().unwrap())
    }

    pub fn redeemer(&self) -> [u8; 32] {
        self.0[18..50].try_into().unwrap()
    }

    pub fn sender(&self) -> [u8; 32] {
        self.0[50..82].try_into().unwrap()
    }

    pub fn refund_address(&self) -> [u8; 32] {
        self.0[82..114].try_into().unwrap()
    }

    pub fn max_fee(&self) -> u64 {
        u64::from_be_bytes(self.0[114..122].try_into().unwrap())
    }

    pub fn init_auction_fee(&self) -> u64 {
        u64::from_be_bytes(self.0[122..130].try_into().unwrap())
    }

    pub fn deadline(&self) -> u32 {
        u32::from_be_bytes(self.0[130..134].try_into().unwrap())
    }

    pub fn redeemer_message_len(&self) -> u32 {
        u32::from_be_bytes(self.0[134..138].try_into().unwrap())
    }

    pub fn redeemer_message(&'a self) -> Payload<'a> {
        Payload::parse(&self.0[138..])
    }

    pub fn parse(span: &'a [u8]) -> Result<Self, &'static str> {
        if span.len() < 138 {
            return Err("FastMarketOrder span too short. Need at least 138 bytes");
        }

        let fast_market_order = Self(span);

        // Check payload length vs actual payload.
        if fast_market_order.redeemer_message().len()
            != usize::try_from(fast_market_order.redeemer_message_len()).unwrap()
        {
            return Err("FastMarketOrder payload length mismatch");
        }

        Ok(fast_market_order)
    }
}

pub trait MessageToVec {
    fn message_to_vec(&self) -> Vec<u8>;
}

impl<'a> MessageToVec for Fill<'a> {
    fn message_to_vec(&self) -> Vec<u8> {
        let msg: &[_] = self.redeemer_message().into();
        msg.to_vec()
    }
}

impl<'a> MessageToVec for FastMarketOrder<'a> {
    fn message_to_vec(&self) -> Vec<u8> {
        let msg: &[_] = self.redeemer_message().into();
        msg.to_vec()
    }
}
