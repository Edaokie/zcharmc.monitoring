"""Django browser sessions; credentials never become localStorage tokens."""
import hashlib
import secrets

from django.contrib.auth import authenticate, login, logout
from django.core.cache import cache
from django.middleware.csrf import get_token
from django.views.decorators.csrf import csrf_protect
from rest_framework import serializers
from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle

FIRMWARE_PERMISSIONS = (
    'monitoring.view_device', 'monitoring.change_device',
    'monitoring.view_firmwarerelease', 'monitoring.change_firmwarerelease',
    'monitoring.view_firmwareapproval',
)


def can_manage_firmware(user):
    return bool(user and user.is_active and user.is_staff and user.has_perms(FIRMWARE_PERMISSIONS))


def user_data(user):
    if not user or not user.is_authenticated:
        return None
    return dict(username=user.get_username(), email=user.email,
                name=user.get_full_name() or user.get_username(),
                role='admin' if user.is_staff else 'client',
                can_manage_firmware=can_manage_firmware(user))


def private(data, status=200):
    response = Response(data, status=status)
    response['Cache-Control'] = 'private, no-store'
    return response


class LoginThrottle(AnonRateThrottle):
    rate = '10/min'
    scope = 'browser-login'


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=254)
    password = serializers.CharField(max_length=1024, trim_whitespace=False, write_only=True)


@api_view(['GET'])
@authentication_classes([SessionAuthentication])
@permission_classes([AllowAny])
def session(request):
    return private(dict(user=user_data(request.user), csrf_token=get_token(request._request)))


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([LoginThrottle])
@csrf_protect
def sign_in(request):
    serializer = LoginSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user = authenticate(request=request._request, **serializer.validated_data)
    if user is None:
        return private({'error': 'Incorrect username or password.'}, status=400)
    login(request._request, user)
    request.session.set_expiry(8 * 60 * 60)
    return private(dict(user=user_data(user), csrf_token=get_token(request._request)))


@api_view(['POST'])
@authentication_classes([SessionAuthentication])
@permission_classes([IsAuthenticated])
def sign_out(request):
    logout(request._request)
    return private(dict(user=None, csrf_token=get_token(request._request)))


@api_view(['POST'])
@authentication_classes([SessionAuthentication])
@permission_classes([IsAuthenticated])
def socket_ticket(request):
    # The browser only sees a short-lived random handle, never the session ID.
    ticket = secrets.token_urlsafe(32)
    cache.set('browser-socket:' + hashlib.sha256(ticket.encode()).hexdigest(),
              request.session.session_key, timeout=120)
    return private({'ticket': ticket})
