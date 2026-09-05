-- Rewards admin pages require table privileges in addition to RLS policies.
-- RLS still limits mutations to the admin policies; these grants only make the tables addressable by authenticated sessions.

grant select, insert, update, delete on table public.partners to authenticated;
grant select, insert, update, delete on table public.bonuses to authenticated;
grant select, insert, update, delete on table public.giveaways to authenticated;
grant select, insert, update, delete on table public.challenges to authenticated;
grant select, insert, update, delete on table public.challenge_tasks to authenticated;
grant select, insert, update, delete on table public.challenge_prizes to authenticated;
grant select on table public.challenge_entries to authenticated;
grant select on table public.challenge_winners to authenticated;
grant select on table public.pickrush_contests to authenticated;
grant select on table public.pickrush_entries to authenticated;
grant select on table public.pickrush_submissions to authenticated;
grant select, insert, update, delete on table public.prize_pool_campaigns to authenticated;
grant select, insert, update, delete on table public.prize_pool_reward_tiers to authenticated;
grant select, insert, update, delete on table public.prize_pool_eligibility_rules to authenticated;
grant select on table public.prize_pool_entries to authenticated;
grant select, insert, update, delete on table public.bookmakers_radar to authenticated;
grant select, insert, update, delete on table public.leaderboard_bots to authenticated;
