-- Admin CRUD access for the rewards/promotions, challenge-content and discovery control tables.
-- Safe to replay: policies are replaced by name so this migration also matches an already-patched project.

drop policy if exists "admin_manage_partners" on public.partners;
create policy "admin_manage_partners" on public.partners for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin_manage_bonuses" on public.bonuses;
create policy "admin_manage_bonuses" on public.bonuses for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin_manage_challenges" on public.challenges;
create policy "admin_manage_challenges" on public.challenges for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin_manage_challenge_tasks" on public.challenge_tasks;
create policy "admin_manage_challenge_tasks" on public.challenge_tasks for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin_manage_challenge_prizes" on public.challenge_prizes;
create policy "admin_manage_challenge_prizes" on public.challenge_prizes for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin_manage_giveaways" on public.giveaways;
create policy "admin_manage_giveaways" on public.giveaways for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin_manage_pickrush_contests" on public.pickrush_contests;
create policy "admin_manage_pickrush_contests" on public.pickrush_contests for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin_manage_prize_pool_campaigns" on public.prize_pool_campaigns;
create policy "admin_manage_prize_pool_campaigns" on public.prize_pool_campaigns for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin_manage_prize_pool_reward_tiers" on public.prize_pool_reward_tiers;
create policy "admin_manage_prize_pool_reward_tiers" on public.prize_pool_reward_tiers for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin_manage_prize_pool_eligibility_rules" on public.prize_pool_eligibility_rules;
create policy "admin_manage_prize_pool_eligibility_rules" on public.prize_pool_eligibility_rules for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin_manage_bookmakers_radar" on public.bookmakers_radar;
create policy "admin_manage_bookmakers_radar" on public.bookmakers_radar for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin_manage_leaderboard_bots" on public.leaderboard_bots;
create policy "admin_manage_leaderboard_bots" on public.leaderboard_bots for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin_manage_reward_catalog" on public.reward_catalog;
create policy "admin_manage_reward_catalog" on public.reward_catalog for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin_manage_reward_features" on public.platform_reward_features;
create policy "admin_manage_reward_features" on public.platform_reward_features for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
