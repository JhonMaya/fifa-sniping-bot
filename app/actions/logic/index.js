import _ from 'lodash';
import Fut from 'fut-promise-18';
import { getApi } from '../../utils/ApiUtil';
import * as bidActions from '../bid';

export function bidCycle() {
  return async (dispatch, getState) => {
    let state = getState();

    // Get unassigned and watchlist here only on first cycle
    if (state.bid.cycles % 10 === 0) {
      await dispatch(bidActions.getUnassigned(state.account.email));
      await dispatch(bidActions.getWatchlist(state.account.email));
      state = getState();
    }

    // Get tradepile at beginning of every cycle
    await dispatch(bidActions.getTradepile(state.account.email));

    // Relist expired trades (and list new ones if needed)
    await dispatch(bidActions.relistItems(state.settings));

    // Increment cycle count
    dispatch(bidActions.setCycleCount(state.bid.cycles + 1));

    // Keep a manual record of our watched trades
    // let trades = _.keyBy(state.bid.watchlist, 'tradeId');
    dispatch(bidActions.setTrades(_.keyBy(state.bid.watchlist, 'tradeId')));

    // Loop players for price update
    for (const player of Object.values(state.player.list)) {
      // Setup API - resets RPM every cycle
      const settings = _.merge({}, state.settings, player.settings);
      // Update prices every hour if auto update price is enabled
      await dispatch(bidActions.updatePrice(player, settings));
    }

    // Loop players for bidding
    state = getState();
    for (const player of Object.values(state.player.list)) {
      // refresh state every player
      state = getState();

      // Setup API - resets RPM every cycle
      const settings = _.merge({}, state.settings, player.settings);
      getApi(state.account.email, settings.rpm);

      // How many of this player is already listed
      // const listed = _.countBy(
      //   state.bid.tradepile,
      //   trade => Fut.getBaseId(trade.itemData.resourceId)
      // );
      dispatch(bidActions.setListed(_.countBy(
        state.bid.tradepile,
        trade => Fut.getBaseId(trade.itemData.resourceId)
      )));

      // const watched = _.countBy(
      //   state.bid.watchlist,
      //   trade => Fut.getBaseId(trade.itemData.resourceId)
      // );
      dispatch(bidActions.setWatched(_.countBy(
        state.bid.watchlist,
        trade => Fut.getBaseId(trade.itemData.resourceId)
      )));

      // Only bid if we don't already have a full trade pile and don't own too many of this player
      if (
        state.bid.bidding
        && state.bid.tradepile.length < state.account.pilesize.tradepile
        && state.account.credits > settings.minCredits
        && _.get(state.bid.listed, player.id, 0) < settings.maxCard
      ) {
        // Snipe BINs
        state = getState();
        await dispatch(bidActions.snipe(player, settings));

        // Place bids
        state = getState();
        await dispatch(bidActions.placeBid(player, settings));
      }

      state = getState();
      if (state.bid.bidding) {
        if (!settings.snipeOnly) {
          // Update watched items and trades
          await dispatch(bidActions.getWatchlist(state.account.email));
          state = getState(); // need to refresh state to get latest watchlist
          dispatch(bidActions.setTrades(_.keyBy(state.bid.watchlist, 'tradeId')));

          // Perform watchlist tracking
          await dispatch(bidActions.continueTracking(settings));
        }

        // buy now goes directly to unassigned now
        await dispatch(bidActions.binNowToUnassigned());

        // Log sold items
        await dispatch(bidActions.logSold());
      }
    }
    // keep going
    await dispatch(bidActions.keepBidding());
  };
}

export { bidCycle as default };
