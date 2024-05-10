use wormhole_raw_vaas::Payload;

/// The non-type-flag contents
#[derive(Debug, Copy, Clone, PartialEq, Eq, Hash)]
pub enum LiquidityLayerDepositMessage<'a> {
    Fill(Fill<'a>),
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
            // The purpose of using this method is knowing that the enum variant is Fill.
            #[allow(clippy::panic)]
            _ => panic!("LiquidityLayerDepositMessage is not Fill"),
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
            // The purpose of using this method is knowing that the enum variant is SlowOrderResponse.
            #[allow(clippy::panic)]
            _ => panic!("LiquidityLayerDepositMessage is not SlowOrderResponse"),
        }
    }

    pub fn parse(span: &'a [u8]) -> Result<Self, &'static str> {
        if span.is_empty() {
            return Err("LiquidityLayerDepositMessage span too short. Need at least 1 byte");
        }

        match span[0] {
            1 => Ok(Self::Fill(Fill::parse(&span[1..])?)),
            2 => Ok(Self::SlowOrderResponse(SlowOrderResponse::parse(
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

    pub fn redeemer_message_len(&self) -> u16 {
        u16::from_be_bytes(self.0[66..68].try_into().unwrap())
    }

    pub fn redeemer_message(&'a self) -> Payload<'a> {
        Payload::parse(&self.0[68..])
    }

    pub fn parse(span: &'a [u8]) -> Result<Self, &'static str> {
        if span.len() < 68 {
            return Err("Fill span too short. Need at least 68 bytes");
        }

        let fill = Self(span);

        // Check payload length vs actual payload.
        if fill.redeemer_message().len() != usize::from(fill.redeemer_message_len()) {
            return Err("Fill payload length mismatch");
        }

        Ok(fill)
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
    pub fn base_fee(&self) -> u64 {
        u64::from_be_bytes(self.0[..8].try_into().unwrap())
    }

    pub fn parse(span: &'a [u8]) -> Result<Self, &'static str> {
        if span.len() != 8 {
            return Err("SlowOrderResponse span too short. Need exactly 8 bytes");
        }

        Ok(Self(span))
    }
}
