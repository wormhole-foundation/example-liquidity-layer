use wormhole_raw_vaas::Payload;

/// The non-type-flag contents
#[derive(Debug, Copy, Clone, PartialEq, Eq, Hash)]
pub enum LiquidityLayerDepositMessage<'a> {
    Fill(Fill<'a>),
    FastFill(FastFill<'a>),
    SlowOrderResponse(SlowOrderResponse<'a>),
}

impl<'a> TryFrom<Payload<'a>> for LiquidityLayerDepositMessage<'a> {
    type Error = &'static str;

    fn try_from(payload: Payload<'a>) -> Result<Self, &'static str> {
        Self::parse(payload.into())
    }
}

impl<'a> AsRef<[u8]> for LiquidityLayerDepositMessage<'a> {
    fn as_ref(&self) -> &[u8] {
        match self {
            Self::Fill(inner) => inner.as_ref(),
            Self::FastFill(inner) => inner.as_ref(),
            Self::SlowOrderResponse(inner) => inner.as_ref(),
        }
    }
}

impl<'a> LiquidityLayerDepositMessage<'a> {
    pub fn span(&self) -> &[u8] {
        self.as_ref()
    }

    pub fn fill(&self) -> Option<&Fill> {
        match self {
            Self::Fill(inner) => Some(inner),
            _ => None,
        }
    }

    pub fn to_fill_unchecked(self) -> Fill<'a> {
        match self {
            Self::Fill(inner) => inner,
            _ => panic!("LiquidityLayerDepositMessage is not Fill"),
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
            _ => panic!("LiquidityLayerDepositMessage is not FastFill"),
        }
    }

    pub fn slow_order_response(&self) -> Option<&SlowOrderResponse> {
        match self {
            Self::SlowOrderResponse(inner) => Some(inner),
            _ => None,
        }
    }

    pub fn to_slow_order_response_unchecked(self) -> SlowOrderResponse<'a> {
        match self {
            Self::SlowOrderResponse(inner) => inner,
            _ => panic!("LiquidityLayerDepositMessage is not SlowOrderResponse"),
        }
    }

    pub fn parse(span: &'a [u8]) -> Result<Self, &'static str> {
        if span.is_empty() {
            return Err("LiquidityLayerDepositMessage span too short. Need at least 1 byte");
        }

        match span[0] {
            11 => Ok(Self::Fill(Fill::parse(&span[1..])?)),
            12 => Ok(Self::FastFill(FastFill::parse(&span[1..])?)),
            14 => Ok(Self::SlowOrderResponse(SlowOrderResponse::parse(
                &span[1..],
            )?)),
            _ => Err("Unknown LiquidityLayerDepositMessage type"),
        }
    }
}

#[derive(Debug, Copy, Clone, PartialEq, Eq, Hash)]
pub struct Fill<'a>(&'a [u8]);

impl<'a> AsRef<[u8]> for Fill<'a> {
    fn as_ref(&self) -> &[u8] {
        self.0
    }
}

impl<'a> Fill<'a> {
    pub fn source_chain(&self) -> u16 {
        u16::from_be_bytes(self.0[..2].try_into().unwrap())
    }

    pub fn order_sender(&self) -> [u8; 32] {
        self.0[2..34].try_into().unwrap()
    }

    pub fn redeemer(&self) -> [u8; 32] {
        self.0[34..66].try_into().unwrap()
    }

    pub fn redeemer_message_len(&self) -> u32 {
        u32::from_be_bytes(self.0[66..70].try_into().unwrap())
    }

    pub fn redeemer_message(&'a self) -> Payload<'a> {
        Payload::parse(&self.0[70..])
    }

    pub fn parse(span: &'a [u8]) -> Result<Self, &'static str> {
        if span.len() < 70 {
            return Err("Fill span too short. Need at least 70 bytes");
        }

        let fill = Self(span);

        // Check payload length vs actual payload.
        if fill.redeemer_message().len() != fill.redeemer_message_len().try_into().unwrap() {
            return Err("Fill payload length mismatch");
        }

        Ok(fill)
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
    pub fn fill(&'a self) -> Fill<'a> {
        Fill::parse(&self.0[..70 + usize::try_from(self.redeemer_message_len()).unwrap()]).unwrap()
    }

    pub fn amount(&self) -> u128 {
        let len = usize::try_from(self.redeemer_message_len()).unwrap();
        u128::from_be_bytes(self.0[70 + len..86 + len].try_into().unwrap())
    }

    // TODO: remove this when encoding changes.
    fn redeemer_message_len(&self) -> u32 {
        u32::from_be_bytes(self.0[66..70].try_into().unwrap())
    }

    pub fn parse(span: &'a [u8]) -> Result<Self, &'static str> {
        if span.len() < 86 {
            return Err("FastFill span too short. Need at least 86 bytes");
        }

        let fast_fill = Self(span);

        // Check payload length vs actual payload.
        let fill = fast_fill.fill();
        if fill.redeemer_message().len() != fill.redeemer_message_len().try_into().unwrap() {
            return Err("Fill payload length mismatch");
        }

        Ok(fast_fill)
    }
}

#[derive(Debug, Copy, Clone, PartialEq, Eq, Hash)]
pub struct SlowOrderResponse<'a>(&'a [u8]);

impl<'a> AsRef<[u8]> for SlowOrderResponse<'a> {
    fn as_ref(&self) -> &[u8] {
        self.0
    }
}

impl<'a> SlowOrderResponse<'a> {
    pub fn base_fee(&self) -> u128 {
        u128::from_be_bytes(self.0[..16].try_into().unwrap())
    }

    pub fn parse(span: &'a [u8]) -> Result<Self, &'static str> {
        if span.len() != 16 {
            return Err("SlowOrderResponse span too short. Need exactly 16 bytes");
        }

        Ok(Self(span))
    }
}
