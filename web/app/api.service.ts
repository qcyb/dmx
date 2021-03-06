import { Injectable } from '@angular/core';
import { Http, Headers, Request, RequestMethod, RequestOptions, Response } from '@angular/http';

import { WebSocketService, WebSocketError } from 'lib/websocket';
import { StatusService } from './status.service'

import * as _ from 'lodash';
import { Observable } from 'rxjs/Observable';
import { Observer } from 'rxjs/Observer';
import { Subscription } from 'rxjs/Subscription';
import { Subject } from 'rxjs/Subject';
import 'rxjs/add/operator/map';
import 'rxjs/add/operator/toPromise';
import 'rxjs/add/operator/retryWhen';
import 'rxjs/add/operator/delay';

import { API, APIEvents, APIOutput, APIOutputs, APIHeads, APIGroups, APIPresets } from './api';
import { Post, Head, Group, Preset } from './head';

@Injectable()
export class APIService {
  private webSocket: Subscription;
  postSubject = new Subject<Post>();

  // state
  loaded: boolean = false;
  outputs: Map<string, APIOutput>;
  heads: Map<string, Head>;
  groups: Map<string, Group>;
  presets: Map<string, Preset>;

  listOutputs(sort?: (APIOutput) => any, filter?: (APIOutput) => boolean): APIOutput[] {
    let outputs = Array.from(this.outputs.values());

    if (filter)
      outputs = _.filter(outputs, filter);

    if (sort)
      outputs = _.sortBy(outputs, sort);

    return outputs;
  }
  listHeads(sort?: (Head) => any, filter?: (Head) => boolean): Head[] {
    let heads = Array.from(this.heads.values());

    if (filter)
      heads = _.filter(heads, filter);

    if (sort)
      heads = _.sortBy(heads, sort);

    return heads;
  }
  listGroups(sort?: (Group) => any, filter?: (Groups) => boolean): Group[] {
    let groups = Array.from(this.groups.values());

    if (filter)
      groups = _.filter(groups, filter);

    if (sort)
      groups = _.sortBy(groups, sort);

    return groups;
  }
  listPresets(sort?: (Preset) => any, filter?: (Preset) => boolean): Preset[] {
    let presets = Array.from(this.presets.values());

    if (filter)
      presets = _.filter(presets, filter);

    if (sort)
      presets = _.sortBy(presets, sort);

    return presets;
  }

  constructor(private http: Http, webSocketService: WebSocketService, public status: StatusService) {
    this.outputs = new Map<string, APIOutput>();
    this.heads = new Map<string, Head>();
    this.groups = new Map<string, Group>();
    this.presets = new Map<string, Preset>();

    this.postSubject.subscribe(
      post => {
        console.log(`POST ${post.type} ${post.id}...`, post.parameters);

        this.post(`/api/${post.type}/${post.id}`, post.parameters).then((response) => {
          // do not update head from POST, wait for websocket...
          console.log(`POST ${post.type} ${post.id} OK`, response);
        });
      }
    );

    this.webSocket = webSocketService.connect<API>('/events')
      .retryWhen(errors =>
        errors.map(error => {
          console.log("WebSocket retry error", error);

          this.status.WebsocketDisconnected(error);
        })
        .delay(3 * 1000)
        .map(() => {
          console.log("WebSocket retry connect");

          this.status.WebsocketConnecting();
        })
      )
      .subscribe(
        (api: API) => {
          this.status.WebsocketEvent();

          console.log("WebSocket event", api);

          this.load(api);
        },
        (error: Error) => {
          console.log("WebSocket fail error", error);

        },
        () => {
          console.log("WebSocket close");

          this.status.WebsocketDisconnected();
        }
      )
    ;
    this.status.WebsocketConnecting();

  }

  private load(api: API) {
    this.loaded = true;

    if (api.Outputs) {
      this.loadOutputs(api.Outputs);
    }

    this.loadHeads(api.Heads);
    this.loadGroups(api.Groups);

    if (api.Presets) {
      this.loadPresets(api.Presets);
    }
  }

  private loadOutputs(apiOutputs: APIOutputs) {
    for (let id in apiOutputs) {
      this.outputs.set(id, apiOutputs[id]);
    }
  }

  private loadHeads(apiHeads: APIHeads) {
    for (let id in apiHeads) {
      let head = this.heads.get(id)

      if (head) {
        head.load(apiHeads[id])
      } else {
        this.heads.set(id, new Head(this.postSubject, apiHeads[id]))
      }
    }
  }

  private loadGroups(apiGroups: APIGroups) {
    for (let id in apiGroups) {
      let group: Group;

      let heads = apiGroups[id].Heads.map((id) => this.heads.get(id));

      if (group = this.groups.get(id)) {
        group.load(apiGroups[id]);
      } else {
        this.groups.set(id, new Group(this.postSubject, apiGroups[id], heads));
      }
    }
  }

  private loadPresets(apiPresets: APIPresets) {
    for (let id in apiPresets) {
      let heads: Head[] = null
      let groups: Group[] = null

      if (apiPresets[id].Config.Heads) {
        heads = Object.keys(apiPresets[id].Config.Heads).map((id) => {
          return this.heads.get(id)
        })
      }

      if (apiPresets[id].Config.Groups) {
        groups = Object.keys(apiPresets[id].Config.Groups).map((id) => {
          return this.groups.get(id)
        })
      }

      this.presets.set(id, new Preset(this.postSubject, apiPresets[id], heads, groups));
    }
  }

  private request(request: Request): Promise<any> {
    let method: string = {
      [RequestMethod.Get]: 'GET',
      [RequestMethod.Post]: 'POST',
    }[request.method];

    this.status.RequestStart(method, request.url);

    return this.http.request(request).toPromise()
      .then(response => response.json())
      .catch(reason => {
        if (reason instanceof Response) {
          throw new Error(reason.toString());

        } else if (reason instanceof Error) {
          throw reason;

        } else {
          throw new Error(reason.toString());
        }
      })
      .then(
        (value) => {
          this.status.RequestEnd(method, request.url);

          return value;
        },
        (error: Error) => {
          this.status.RequestEnd(method, request.url, error);

          throw error;
        }
      )
    ;
  }

  private get(url): Promise<any> {
    let request = new Request({
      url: url,
      method: RequestMethod.Get,
    });

    return this.request(request);
  }

  private post(url, params): Promise<any> {
    let request = new Request({
      url: url,
      method: RequestMethod.Post,
      headers: new Headers({
        'Content-Type': 'application/json',
      }),
      body: params,
    });

    return this.request(request);
  }
}
