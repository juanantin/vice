import { DISTRICTS, GAME, TICKER, TOKENS } from "../lib/config";

export default function WhitePaper() {
  const fixed = DISTRICTS.filter((d) => d.earns !== "vote");
  const voted = DISTRICTS.filter((d) => d.earns === "vote").map((d) => d.city).join(" and ");
  const earnsList = fixed.map((d) => `${d.city} earns ${TOKENS[d.earns as number].token}`).join(", ");
  return (
    <article className="tab paper">
      <h2>{GAME.name} — White Paper</h2>
      <p className="muted small">Version 0.1 · draft for review</p>

      <h3>1. What is {GAME.name}?</h3>
      <p>
        {GAME.name} is a city-building game on Elysium. You burn {TICKER} to open a {GAME.building} on a map of Miami
        drawn from real geography. Every {GAME.building} is an NFT that receives a share of the city&apos;s purchases.
        You join one of four districts, and each district earns one token: {earnsList}, and {voted} earns whichever
        of the three the weekly vote picks. Your district also decides where your {GAME.building} stands and which
        crew you run with in the weekly turf race.
      </p>

      <h3>2. {TICKER} and the city tax</h3>
      <ul>
        <li>{TICKER} launches on Volta, the Uniswap launchpad on Elysium, paired with $VOLTA. Every trade pays the pool&apos;s swap fee in $VOLTA.</li>
        <li>Of that fee, Volta&apos;s rules send 70% to the launch&apos;s chosen split and 30% to the Volta protocol. {GAME.name} sends its whole share to the creator, and the creator NFT is held by the ViceVault, so the creator share is the city tax. Nobody can take that NFT out of the vault.</li>
        <li>Anyone can call collectCreatorFees() to move the tax from Volta&apos;s fee escrow into the vault; the keeper does it every hour.</li>
        <li>70% of the tax buys each district&apos;s token for its residents, 15% goes to the weekly turf race, and 15% stays in $VOLTA for operations (paid to a 2-of-3 multisig).</li>
      </ul>

      <h3>3. How purchases work</h3>
      <ul>
        <li>A keeper checks the vault every hour. Once a minimum amount of $VOLTA is waiting, it buys, capped per order, one order at a time, at least 10 minutes apart. Anything left waits for the next hour.</li>
        <li>Each order is split across the four districts by how many {GAME.buildings} each has, so every {GAME.building} gets the same value. Each district&apos;s part buys its token; districts on the same token share one swap.</li>
        <li>Downtown&apos;s part (and Wynwood&apos;s, in a week the vote picks $VOLTA) needs no swap: the $VOLTA is simply set aside for those residents.</li>
        <li>SENT and VOID are bought through their Volta pools. Every swap is checked against the pool&apos;s average price; if a fill is more than 4% worse, the whole order is rejected, the $VOLTA stays in the vault and buying pauses for 6 hours.</li>
        <li>Until the first {GAME.building} exists, the residents&apos; share simply waits in the vault.</li>
        <li>If nothing is bought for 24 hours, the keeper rests. Anyone can restart it by calling requestBuy().</li>
        <li>Tax that is not spent in a week rolls over to the next.</li>
      </ul>

      <h3>4. Buildings</h3>
      <ul>
        <li>3,000 {GAME.buildings} in total. The Mayor&apos;s hall on Watson Island, #0, is minted at launch; it earns nothing and has no vote.</li>
        <li>To move in: choose a district ({DISTRICTS.map((d) => d.city).join(", ")}) and one of 3 styles. Both are permanent. Optionally enter the number of the building that invited you.</li>
        <li>Numbers are sequential across the city. Within a district, earlier {GAME.buildings} get the plots nearest its landmark.</li>
        <li>{GAME.name} {GAME.buildings} are normal NFTs: you can sell or transfer them. Unclaimed rewards and height move with the building.</li>
        <li>Invites are decorations only (flags, neon signs, fireworks). There is no referral income.</li>
        <li>When all 3,000 are built, the city is complete and building closes.</li>
      </ul>

      <h3>5. Price</h3>
      <ul>
        <li>Early bird: the first 300 {GAME.buildings} cost $40, for 6 hours from launch. If they sell out early, the next phase opens when the 6 hours end.</li>
        <li>Then: #1–800 $52 · #801–1,500 $68 · #1,501–2,300 $88 · #2,301–3,000 $120.</li>
        <li>You pay by burning {TICKER}: tokens burned = USD price ÷ {TICKER} price. Burned tokens go to the dead address forever.</li>
        <li>During early bird the price used follows drops at once and follows rises only after they hold for 60 seconds. Afterwards it is the lower of the spot price and the 10-minute average (from Volta's price oracle), so pumping the price never makes building cheaper.</li>
        <li>You set a maximum burn. If the price moves above it, the build is cancelled.</li>
      </ul>

      <h3>6. Rewards</h3>
      <ul>
        <li>Each district&apos;s part of a purchase is split equally among that district&apos;s {GAME.buildings} that exist at that moment.</li>
        <li>Purchases during the early-bird window go to each district&apos;s early-bird pool, shared among that district&apos;s early-bird {GAME.buildings} when the window ends.</li>
        <li>claim / claimMany pays every token a {GAME.building} has earned in one transaction (a Wynwood {GAME.building} can hold all three). There is no cooldown and rewards never expire. If one token can&apos;t be transferred, it is skipped and stays claimable.</li>
      </ul>

      <h3>7. Height</h3>
      <p>
        A {GAME.building} grows with the total value it has claimed (valued at purchase time): L1 $0 · L2 $5 · L3 $20 · L4 $50
        · L5 $100, then one more floor for every extra $50, with no limit. Height is cosmetic.
      </p>

      <h3>8. Weekly vote</h3>
      <ul>
        <li>Each {GAME.building}, in any district, has one vote per week for the token {voted} earns next week. {fixed.map((d) => d.city).join(", ")} always keep their own token.</li>
        <li>Voting closes every Sunday at 20:00 Rome time (2 PM in Miami most weeks; the contracts keep the original deadline). Most votes wins; a tie or no votes keeps the current token.</li>
        <li>A {GAME.building} that already voted keeps that vote for the week even if it is sold.</li>
      </ul>

      <h3>9. Turf race</h3>
      <ul>
        <li>The district with the most new {GAME.buildings} in the week wins the 15% street pool, shared equally by all its {GAME.buildings}. Tied districts share it equally per {GAME.building}.</li>
        <li>If nobody moved in that week, every district that has {GAME.buildings} shares the pool.</li>
        <li>The winner is only known at the deadline, so the street pool waits in $VOLTA during the week and is bought in the winning district&apos;s own token right after.</li>
        <li>After all 3,000 are built, the competition ends and the street pool is shared across the whole city.</li>
      </ul>

      <h3>10. Settlement</h3>
      <p>
        Weeks close automatically: the first vote, build, buy or claim after the Sunday deadline settles the past week
        (vote result and street pool). Anyone can also call settle().
      </p>

      <h3>11. Permissions and safety</h3>
      <ul>
        <li>Anyone: trigger buys, settle the week, pay out the ops share, restart the keeper.</li>
        <li>Residents: vote and claim for their own {GAME.buildings}.</li>
        <li>Ops multisig (2-of-3): receives the 15% ops share, nothing else.</li>
        <li>No contract has a withdrawal function. Oracle, swap route and buy-rule changes go through a public 48-hour timelock. The NFT and the vault cannot be upgraded.</li>
      </ul>

      <h3>12. Risks</h3>
      <p className="muted">
        Reward tokens can fall in value or become illiquid. Smart contracts can have bugs, and {GAME.name}&apos;s contracts
        have not been audited. Prices come from on-chain averages that can be wrong in
        extreme markets. Only use money you can afford to lose.
      </p>

      <h3>13. The map</h3>
      <p className="muted">
        The map is drawn from real geography: coastline, rivers, causeways and roads come from OpenStreetMap
        (© OpenStreetMap contributors, ODbL) via Overture Maps. Buildings, crews and landmarks are original art.
      </p>

      <h3>14. Follow the city</h3>
      <p>
        News, weekly results and launch updates: <a href={GAME.x} target="_blank" rel="noreferrer">{GAME.xHandle}</a> on X.
      </p>
    </article>
  );
}
