A Research-Based Mathematical Weather Model for Static Planet Generation

Given your inputs:

Heightmap H(x,y)

Heat distribution map T(x,y)

Rainfall/moisture map M(x,y) (initial hydrology)

Sea level

Final output:

high-resolution static weather fields

biome classification



the closest thing to modern climate science is not a full General Circulation Model (GCM), which is computationally excessive, but an intermediate-complexity atmospheric model derived from primitive equations and parameterizations. This is exactly the class of models used by SPEEDY, PlaSim, and NeuralGCM. 


---

Recommended Architecture

Instead of directly generating biomes:

Heightmap
    ↓
Temperature field
    ↓
Pressure field
    ↓
Planetary circulation
    ↓
Wind vectors
    ↓
Ocean moisture sources
    ↓
Humidity transport
    ↓
Cloud formation
    ↓
Orographic lifting
    ↓
Rainfall
    ↓
Seasonality
    ↓
Weather statistics
    ↓
Biome map


---

Level 1: Surface Temperature

Temperature already exists, but should be corrected for altitude.

Environmental lapse rate

Atmospheric temperature decreases:

\Gamma = 6.5 \ K/km

Therefore:

T_{surface}(x,y)
=
T_{base}(x,y)
-
0.0065H(x,y)

where height is in meters.


---

Level 2: Surface Pressure

Hydrostatic equation:

P=P_0e^{-H/H_s}

where



scale height


H_s\approx8500m

giving:

P(x,y)
=
101325
e^{-H/8500}

This creates high pressure over cold dense regions and lower pressure over warm regions. 


---

Level 3: Latitudinal Circulation

Earth naturally forms three cells:

Hadley

0–30°

Ferrel

30–60°

Polar

60–90°

The zonal wind sign becomes:

0-30°      easterlies
30-60°     westerlies
60-90°     polar easterlies

For arbitrary planets:

Number of cells:

N_c
=
\sqrt{
\frac{\Omega R}
{\sqrt{gH}}
}

where

Ω = rotation rate

R = radius

g = gravity


Fast rotators:

more cells

more jet streams


Slow rotators:

giant Hadley cells



---

Coriolis Parameter

f=2\Omega\sin\phi

where

 is latitude.

This determines how winds curve.


---

Level 4: Pressure Gradient Force

Atmospheric flow is driven by:

F_p
=
-\nabla P

Using finite differences:

\frac{\partial P}{\partial x}
=
\frac{P_{i+1}-P_{i-1}}{2\Delta x}

\frac{\partial P}{\partial y}
=
\frac{P_{j+1}-P_{j-1}}{2\Delta y}


---

Geostrophic Wind

Approximate wind vectors:

u
=
-\frac1{\rho f}
\frac{\partial P}{\partial y}

v
=
\frac1{\rho f}
\frac{\partial P}{\partial x}

giving:

WindVector(x,y)

This is one of the central approximations used in atmospheric models. 


---

Level 5: Moisture Sources

Ocean cells:

humidity = saturation

Land cells:

q=q_{previous}


---

Saturation Vapor Pressure

Clausius-Clapeyron relation:

e_s(T)
=
6.112
e^{\frac{17.67T}{T+243.5}}

where T is °C.

Maximum water content:

q_s
=
0.622
\frac{e_s}{P}

Warm air can hold much more moisture.


---

Relative Humidity

RH
=
\frac{q}{q_s}

Cloud formation begins around:

RH > 0.8


---

Level 6: Moisture Advection

Transport equation:

\frac{\partial q}{\partial t}
=
-u\frac{\partial q}{\partial x}
-
v\frac{\partial q}{\partial y}
+
S
-
C

where

S = evaporation

C = condensation


This is probably the most important equation in procedural climate generation.


---

Evaporation

Bulk aerodynamic formula:

E
=
C_eU(q_s-q)

where

U = wind speed

Ce ≈ 0.0015


Warm oceans become major moisture factories.


---

Orographic Lifting

When wind encounters mountains:

Vertical velocity:

w
=
u\frac{\partial H}{\partial x}
+
v\frac{\partial H}{\partial y}

Positive values:

air forced upward

Cloud formation occurs.

Orographic models show this reproduces mountain rainfall extremely well. 


---

Condensation

If

RH>1

then

C
=
k(RH-1)

with

k≈0.3


---

Rainfall

R
=
\alpha C

Typical:

\alpha≈0.8

giving annual precipitation:

mm/year


---

Rain Shadow

Descending air:

w<0

Humidity decreases:

q_{new}
=
0.95q

producing:

Atacama

Gobi

Patagonia


style deserts.


---

Convective Rain

Tropical thunderstorms:

Convective Available Potential Energy:

CAPE
=
\int
g
\frac{T_p-T_e}{T_e}
dz

Simplified:

R_c
=
k(T-26)^2 RH

for

T>26°C

This produces:

Amazon

Congo

Indonesia



---

Cyclones

Pressure minima:

\nabla^2P<0

can generate stochastic storm systems.

Intensity:

I
=
|\nabla P|

which can feed:

rainfall variance

cloud cover

storm frequency



---

Jet Streams

Strong temperature gradients:

J
=
|\nabla T|

produce high-altitude winds.

Useful for:

desert placement

storm tracks



---

Seasonal Oscillation

Solar declination:

\delta
=
23.44°
\sin
\left(
\frac{2\pi d}{365}
\right)

Move the thermal equator north/south.

Run:

January

April

July

October


Average results.

This produces:

monsoons

Mediterranean climates

wet/dry tropics



---

Ocean Currents

Approximate current:

\vec C
=
\vec W + \beta\nabla H

Warm currents:

increase temperature and rainfall.

Cold currents:

produce deserts.

Examples:

Peru Current

Benguela Current



---

Cloud Fraction

Cloud
=
RH^2

More advanced:

Cloud=
\frac{RH^4}
{RH^4+k}

with

k≈0.6.


---

Snow

If

T<0

then

Snow=Rain

Else

0

Accumulation:

S_{t+1}
=
S_t
+
Snow
-
Melt


---

Weather Variability

Deterministic climate is too smooth.

Add red noise:

Ornstein-Uhlenbeck process:

dx
=
\theta(\mu-x)dt
+
\sigma dW

This reproduces realistic variability. 


---

Derived Climate Variables

Compute:

Mean annual temperature

MAT

Warmest month

Tmax

Coldest month

Tmin

Annual precipitation

MAP

Wettest month

Pmax

Driest month

Pmin

Seasonality index

S=
\frac{P_{max}-P_{min}}
{MAP}


---

Feed Into Köppen-Geiger

Using:

MAT
Tmax
Tmin
MAP
Pmax
Pmin

you can classify into:

Af

Am

Aw

BWh

BWk

BSh

BSk

Csa

Csb

Cfa

Cfb

Dfa

Dfb

Dfc

ET

EF


and all other subclasses. 


---

For 16k–32k Worlds

The highest realism approach would be a hierarchy:

Global scale

(~256×128)

Primitive-equation circulation.

↓

Continental scale

(1024×512)

Humidity advection.

↓

Regional scale

(4096×2048)

Orographic precipitation.

↓

Final map

(16384–32768)

Downscaling with fractal turbulence and stochastic weather noise.

This hierarchical approach closely resembles modern climate and atmospheric models rather than the much simpler "temperature + rainfall lookup table" common in procedural generation. It is probably the highest level of physical realism achievable for static map generation without running a full GCM. 

The next level beyond this would be a full Earth-system architecture resembling PlaSim, SPEEDY, or a reduced-resolution General Circulation Model, which can still be practical for procedural planet generation and would produce not only climate maps but prevailing winds, storm tracks, cloud cover, snowpack, and realistic biome transitions.