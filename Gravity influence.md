

The ideal architecture is:

Orbital mechanics
        ↓
Gravity field
        ↓
Geoid solver
        ↓
Mean sea level
        ↓
Dynamic tides
        ↓
Hydrology and erosion
        ↓
Biome and coastline generation

This follows how geophysics actually treats oceans and sea level. 


---

Level I — Physically Consistent Geoid Solver

This is the academic approach.

Sea level is an equipotential surface:

W = V + \Phi

where

 = gravitational potential

 = rotational potential


Water settles on surfaces where

W=W_0

not at a fixed height. 


---

Spherical Harmonics

Modern geoid models are represented as spherical harmonics:

V(r,\theta,\lambda)
=
\frac{GM}{r}
\left(
1+
\sum_{n=2}^{N}
\sum_{m=0}^{n}
\left(
C_{nm}\cos m\lambda
+
S_{nm}\sin m\lambda
\right)
P_{nm}(\cos\theta)
\right)

Exactly this principle is used by NOAA and EGM models. 


---

Generator Implementation

Rather than computing thousands of coefficients:

Low order harmonics

Keep:

J2 (oblateness)

degree 3

degree 4

degree 5


Add procedural mass anomalies:

geoid =
J2_component
+ degree3
+ degree4
+ mantle_density_noise;

This produces:

continental-scale sea level variation

realistic basin asymmetry

gravity anomalies


without excessive cost.


---

Level II — Rotation

Earth's rotation contributes significantly.

Centrifugal potential:

\Phi_c
=
-\frac12\omega^2r^2\sin^2\phi

where

ω = angular velocity


Fast rotation:

Produces:

equatorial bulge

lower effective gravity at equator

higher polar gravity



---

Implementation

rotation_term =
k_rot *
sin(latitude)^2;

Typical amplitude:

Earth:

≈21 km radius difference.


---

Level III — Multiple Moons

This becomes much more interesting.

For moon i:

U_i=
\frac{GM_i}{d_i^3}
P_2(\cos\theta_i)

Total tidal potential:

U_{total}
=
\sum_i U_i


---

Important result

Tidal force scales as:

F_t\propto\frac{M}{d^3}

Distance matters far more than mass.

A moon twice as close creates eight times stronger tides.


---

Three-Moon System

Suppose:

Moon A:

1 Earth moon

Moon B:

0.7 lunar mass

Moon C:

0.3 lunar mass

Then:

tide_total =
tideA+tideB+tideC;

Because each moon has:

phase_i(t)
=
ω_i t+φ_i

their interference produces:

Spring tides

Constructive overlap.

Neap tides

Destructive overlap.

Beat cycles

Long super-periods.

Wandering flood zones

Coastal regions periodically inundated.


---

Level IV — Love Numbers

The deformation response of the planet itself is measured by Love numbers.

These originate from A. E. Love (1909) and are still used in modern tidal theory. 

Earth:

k_2≈0.3

Large liquid worlds:

higher k₂

Rigid worlds:

lower k₂


---

Implementation:

tide_amplitude *= k2;

This gives:

ocean flexibility

crust deformation

giant ocean worlds



---

Level V — Gravity Scaling

Surface gravity:

g=
\frac{GM}{R^2}

Tidal height roughly scales:

A_t\propto\frac1g

Therefore:

2 g world

Tides ≈ half Earth's.

0.5 g world

Tides ≈ double.


---

Implementation:

A_tide =
earth_tide *
(1/g_factor);


---

Level VI — Dynamic Ocean Height Map

Now sea level becomes:

S(x,y,t)
=
G(x,y)
+
T(x,y,t)

where

G

Static geoid.

T

Dynamic tide.


---

Ocean mask:

ocean =
heightmap < seaLevel(x,y,t)

This means coastlines themselves move.


---

Level VII — Sedimentation and Erosion

This is where realism explodes.

Because:

High-tide regions

Experience:

tidal flats

estuaries

marshes


Strong currents

Produce:

barrier islands

channels


Resonant basins

Produce:

enormous tides

drowned coasts


Over millions of years:

terrain += erosion(tidal_energy)

The terrain slowly adapts.


---

Hybrid Solver for 16K–32K Worlds

I think this is the sweet spot.


---

Stage 1

Tectonics

Produces:

heightmap H


---

Stage 2

Gravity field

Produces:

gravity map g(x,y)

using:

rotation

harmonics

mantle density



---

Stage 3

Geoid

Produces:

mean_sea_level G(x,y)


---

Stage 4

Orbital simulation

Tracks:

moon positions

eccentricities

inclinations



---

Stage 5

Dynamic tides

Produces:

T(x,y,t)


---

Stage 6

Hydrology

Rivers and ocean interaction.


---

Stage 7

Long-term erosion

Updates:

H(x,y)


---

Computational Cost

For a 32k map:

Tectonics

seconds–minutes.

Geoid

seconds.

Orbital mechanics

essentially free.

Dynamic tides

milliseconds.

Hydraulic erosion

minutes.

Million-year coastal evolution

hours.


---

The next level beyond this—and arguably the closest to a research-grade planetary generator—would be to couple:

1. orbital mechanics,


2. tidal theory,


3. viscoelastic mantle response,


4. glacial-isostatic adjustment,


5. mantle convection,


6. plate tectonics,



into one feedback system.

That approaches the territory of models like:

SELEN

CitcomS

ASPECT

GPlates

Underworld


used in geodynamics and paleogeography research.

At that point, the world generator stops being a terrain generator and starts becoming a simplified planet simulator.